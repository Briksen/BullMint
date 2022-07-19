import React, { useCallback, useEffect, useMemo, useState } from "react";
import SimpleDialog from "./Modal";
// import img_4 from '../assets/4.jpeg'
import img_5 from "../assets/bull.gif";
import { WalletDialogButton } from "@solana/wallet-adapter-material-ui";
import styled from "@emotion/styled";
import { MintButton } from "./MintButton";
import * as anchor from "@project-serum/anchor";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import {
  awaitTransactionSignatureConfirmation,
  createAccountsForMint,
  getCandyMachineState,
  getCollectionPDA,
  mintOneToken,
} from "../utils/candy-machine";
import { Alert, Box, Snackbar, Stack, Typography } from "@mui/material";
import axios from "axios";
import { url } from "../utils/environment";
import { formatNumber, getAtaForMint, toDate } from "../utils/utils";
import { Connection } from "@solana/web3.js";
import { MintCountdown } from "./MintCountdown";
const ConnectButton = styled(WalletDialogButton)({
  width: "200px",
  height: "60px",
  marginTop: "10px",
  marginBottom: "5px",
  background: "rgb(165, 22, 22)",
  color: "#ffffff",
  fontSize: "16px",
  marginRight: "10px",
  fontWeight: "bold",
  "&:hover": {
    backgroundColor: "transparent",
  },
});
const Main = (props) => {
  const [open, setOpen] = useState(false);
  const handleClickOpen = () => {
    setOpen(true);
  };
  const handleClose = (value) => {
    setOpen(false);
  };
  const [isUserMinting, setIsUserMinting] = useState(false);
  const [candyMachine, setCandyMachine] = useState();
  const [alertState, setAlertState] = useState({
    open: false,
    message: "",
    severity: undefined,
  });
  const [isActive, setIsActive] = useState(false);
  const [currentShift, setCurrentShift] = useState(0);
  const [endDate, setEndDate] = useState();
  const [itemsRemaining, setItemsRemaining] = useState();
  const [isWhitelistUser, setIsWhitelistUser] = useState(false);
  const [isPresale, setIsPresale] = useState(false);
  const [isValidBalance, setIsValidBalance] = useState(false);
  const [discountPrice, setDiscountPrice] = useState();
  const [needTxnSplit, setNeedTxnSplit] = useState(true);
  const [setupTxn, setSetupTxn] = useState();

  const rpcUrl = props.rpcHost;
  const wallet = useWallet();
  const cluster = props.network;
  const anchorWallet = useMemo(() => {
    if (
      !wallet ||
      !wallet.publicKey ||
      !wallet.signAllTransactions ||
      !wallet.signTransaction
    ) {
      return;
    }

    return {
      publicKey: wallet.publicKey,
      signAllTransactions: wallet.signAllTransactions,
      signTransaction: wallet.signTransaction,
    };
  }, [wallet]);

  const refreshCandyMachineState = useCallback(
    async (commitment = "confirmed") => {
      if (!anchorWallet) {
        return;
      }
      if (props.error !== undefined) {
        setAlertState({
          open: true,
          message: props.error,
          severity: "error",
          hideDuration: null,
        });
        return;
      }

      const connection = new Connection(props.rpcHost, commitment);

      if (props.candyMachineId) {
        try {
          const cndy = await getCandyMachineState(
            anchorWallet,
            props.candyMachineId,
            connection
          );
          const currentSlot = await connection.getSlot();
          const blockTime = await connection.getBlockTime(currentSlot);
          const shift = new Date().getTime() / 1000 - blockTime;

          let active =
            cndy?.state.goLiveDate?.toNumber() + shift <
            new Date().getTime() / 1000;
          let presale = false;

          // duplication of state to make sure we have the right values!
          let isWLUser = false;
          let userPrice = cndy.state.price;

          // whitelist mint?
          if (cndy?.state.whitelistMintSettings) {
            // is it a presale mint?
            if (
              cndy.state.whitelistMintSettings.presale &&
              (!cndy.state.goLiveDate ||
                cndy.state.goLiveDate.toNumber() + shift >
                  new Date().getTime() / 1000)
            ) {
              presale = true;
            }
            // is there a discount?
            if (cndy.state.whitelistMintSettings.discountPrice) {
              setDiscountPrice(cndy.state.whitelistMintSettings.discountPrice);
              userPrice = cndy.state.whitelistMintSettings.discountPrice;
            } else {
              setDiscountPrice(undefined);
              // when presale=false and discountPrice=null, mint is restricted
              // to whitelist users only
              if (!cndy.state.whitelistMintSettings.presale) {
                cndy.state.isWhitelistOnly = true;
              }
            }
            // retrieves the whitelist token
            const mint = new anchor.web3.PublicKey(
              cndy.state.whitelistMintSettings.mint
            );
            const token = (
              await getAtaForMint(mint, anchorWallet.publicKey)
            )[0];

            try {
              const balance = await connection.getTokenAccountBalance(token);
              isWLUser = parseInt(balance.value.amount) > 0;
              // only whitelist the user if the balance > 0
              setIsWhitelistUser(isWLUser);

              if (cndy.state.isWhitelistOnly) {
                active = isWLUser && (presale || active);
              }
            } catch (e) {
              setIsWhitelistUser(false);
              // no whitelist user, no mint
              if (cndy.state.isWhitelistOnly) {
                active = false;
              }
              console.log(
                "There was a problem fetching whitelist token balance"
              );
              console.log(e);
            }
          }
          userPrice = isWLUser ? userPrice : cndy.state.price;

          if (cndy?.state.tokenMint) {
            // retrieves the SPL token
            const mint = new anchor.web3.PublicKey(cndy.state.tokenMint);
            const token = (
              await getAtaForMint(mint, anchorWallet.publicKey)
            )[0];
            try {
              const balance = await connection.getTokenAccountBalance(token);

              const valid = new anchor.BN(balance.value.amount).gte(userPrice);

              // only allow user to mint if token balance >  the user if the balance > 0
              setIsValidBalance(valid);
              active = active && valid;
            } catch (e) {
              setIsValidBalance(false);
              active = false;
              // no whitelist user, no mint
              console.log("There was a problem fetching SPL token balance");
              console.log(e);
            }
          } else {
            const balance = new anchor.BN(
              await connection.getBalance(anchorWallet.publicKey)
            );
            const valid = balance.gte(userPrice);
            setIsValidBalance(valid);
            active = active && valid;
          }

          // datetime to stop the mint?
          if (cndy?.state.endSettings?.endSettingType.date) {
            setEndDate(
              toDate(cndy.state.endSettings.number.add(new anchor.BN(shift)))
            );
            if (
              new Date().getTime() / 1000 >
              cndy.state.endSettings.number.toNumber() + shift
            ) {
              active = false;
            }
          }
          // amount to stop the mint?
          if (cndy?.state.endSettings?.endSettingType.amount) {
            let limit = Math.min(
              cndy.state.endSettings.number.toNumber(),
              cndy.state.itemsAvailable
            );
            if (cndy.state.itemsRedeemed < limit) {
              setItemsRemaining(limit - cndy.state.itemsRedeemed);
            } else {
              setItemsRemaining(0);
              cndy.state.isSoldOut = true;
            }
          } else {
            setItemsRemaining(cndy.state.itemsRemaining);
          }

          if (cndy.state.isSoldOut) {
            active = false;
          }

          const [collectionPDA] = await getCollectionPDA(props.candyMachineId);
          const collectionPDAAccount = await connection.getAccountInfo(
            collectionPDA
          );
          setIsActive((cndy.state.isActive = active));
          setCurrentShift(shift);

          setIsPresale((cndy.state.isPresale = presale));
          setCandyMachine(cndy);

          const txnEstimate =
            892 +
            (!!collectionPDAAccount && cndy.state.retainAuthority ? 182 : 0) +
            (cndy.state.tokenMint ? 66 : 0) +
            (cndy.state.whitelistMintSettings ? 34 : 0) +
            (cndy.state.whitelistMintSettings?.mode?.burnEveryTime ? 34 : 0) +
            (cndy.state.gatekeeper ? 33 : 0) +
            (cndy.state.gatekeeper?.expireOnUse ? 66 : 0);

          setNeedTxnSplit(txnEstimate > 1230);
        } catch (e) {
          if (e instanceof Error) {
            if (
              e.message === `Account does not exist ${props.candyMachineId}`
            ) {
              setAlertState({
                open: true,
                message: `Couldn't fetch candy machine state from candy machine with address: ${props.candyMachineId}, using rpc: ${props.rpcHost}! You probably typed the REACT_APP_CANDY_MACHINE_ID value in wrong in your .env file, or you are using the wrong RPC!`,
                severity: "error",
                hideDuration: null,
              });
            } else if (
              e.message.startsWith("failed to get info about account")
            ) {
              setAlertState({
                open: true,
                message: `Couldn't fetch candy machine state with rpc: ${props.rpcHost}! This probably means you have an issue with the REACT_APP_SOLANA_RPC_HOST value in your .env file, or you are not using a custom RPC!`,
                severity: "error",
                hideDuration: null,
              });
            }
          } else {
            setAlertState({
              open: true,
              message: `${e}`,
              severity: "error",
              hideDuration: null,
            });
          }
          console.log(e);
        }
      } else {
        setAlertState({
          open: true,
          message: `Your REACT_APP_CANDY_MACHINE_ID value in the .env file doesn't look right! Make sure you enter it in as plain base-58 address!`,
          severity: "error",
          hideDuration: null,
        });
      }
    },
    [anchorWallet, props.candyMachineId, props.error, props.rpcHost]
  );

  const onMint = async (beforeTransactions = [], afterTransactions = []) => {
    try {
      setIsUserMinting(true);
      document.getElementById("#identity")?.click();
      let UserData;
      try {
        const { data } = await axios.get(
          url + `/user/${wallet.publicKey.toString()}`
        );
        UserData = data;
      } catch (error) {}
      if (UserData && +UserData?.nftBought === 5) {
        setAlertState({
          open: true,
          message: "You cannot buy more than 5 NFT.",
          severity: "error",
        });
      } else if (
        wallet.connected &&
        candyMachine?.program &&
        wallet.publicKey
      ) {
        let setupMint;
        if (needTxnSplit && setupTxn === undefined) {
          setAlertState({
            open: true,
            message: "Please sign account setup transaction",
            severity: "info",
          });
          setupMint = await createAccountsForMint(
            candyMachine,
            wallet.publicKey
          );
          let status = { err: true };
          if (setupMint.transaction) {
            status = await awaitTransactionSignatureConfirmation(
              setupMint.transaction,
              props.txTimeout,
              props.connection,
              true
            );
          }
          if (status && !status.err) {
            setSetupTxn(setupMint);
            setAlertState({
              open: true,
              message:
                "Setup transaction succeeded! Please sign minting transaction",
              severity: "info",
            });
          } else {
            setAlertState({
              open: true,
              message: "Mint failed! Please try again!",
              severity: "error",
            });
            setIsUserMinting(false);
            return;
          }
        } else {
          setAlertState({
            open: true,
            message: "Please sign minting transaction",
            severity: "info",
          });
        }

        let mintResult = await mintOneToken(
          candyMachine,
          wallet.publicKey,
          beforeTransactions,
          afterTransactions,
          setupMint ?? setupTxn
        );

        let status = { err: true };
        let metadataStatus = null;
        if (mintResult) {
          status = await awaitTransactionSignatureConfirmation(
            mintResult.mintTxId,
            props.txTimeout,
            props.connection,
            true
          );

          metadataStatus =
            await candyMachine.program.provider.connection.getAccountInfo(
              mintResult.metadataKey,
              "processed"
            );
          console.log("Metadata status: ", !!metadataStatus);
        }

        if (status && !status.err && metadataStatus) {
          // manual update since the refresh might not detect
          // the change immediately
          let remaining = itemsRemaining - 1;
          setItemsRemaining(remaining);
          setIsActive((candyMachine.state.isActive = remaining > 0));
          candyMachine.state.isSoldOut = remaining === 0;
          setSetupTxn(undefined);
          setAlertState({
            open: true,
            message: "Congratulations! Mint succeeded!",
            severity: "success",
            hideDuration: 7000,
          });
          let obj = {
            walletAddress: wallet.publicKey.toString(),
            nftBought: UserData ? UserData.nftBought + 1 : 1,
          };
          await axios.post(url + "/privateUser", obj);
          refreshCandyMachineState("processed");
        } else if (status && !status.err) {
          setAlertState({
            open: true,
            message:
              "Mint likely failed! Anti-bot SOL 0.01 fee potentially charged! Check the explorer to confirm the mint failed and if so, make sure you are eligible to mint before trying again.",
            severity: "error",
            hideDuration: 8000,
          });
          refreshCandyMachineState();
        } else {
          setAlertState({
            open: true,
            message: "Mint failed! Please try again!",
            severity: "error",
          });
          refreshCandyMachineState();
        }
      }
    } catch (error) {
      let message = error.msg || "Minting failed! Please try again!";
      if (!error.msg) {
        if (!error.message) {
          message = "Transaction timeout! Please try again.";
        } else if (error.message.indexOf("0x137")) {
          console.log(error);
          message = `SOLD OUT!`;
        } else if (error.message.indexOf("0x135")) {
          message = `Insufficient funds to mint. Please fund your wallet.`;
        }
      } else {
        if (error.code === 311) {
          console.log(error);
          message = `SOLD OUT!`;
          window.location.reload();
        } else if (error.code === 312) {
          message = `Minting period hasn't started yet.`;
        }
      }

      setAlertState({
        open: true,
        message,
        severity: "error",
      });
      // updates the candy machine state to reflect the latest
      // information on chain
      refreshCandyMachineState();
    } finally {
      setIsUserMinting(false);
    }
  };
  useEffect(() => {
    refreshCandyMachineState();
  }, [
    anchorWallet,
    props.candyMachineId,
    props.connection,
    refreshCandyMachineState,
  ]);

  useEffect(() => {
    (function loop() {
      setTimeout(() => {
        refreshCandyMachineState();
        loop();
      }, 20000);
    })();
  }, [refreshCandyMachineState]);
  console.log(candyMachine, "candyMachine");
  const toggleMintButton = (currentShift) => {
    let active = !isActive || isPresale;

    if (active) {
      if (candyMachine.state.isWhitelistOnly && !isWhitelistUser) {
        active = false;
      }
      if (endDate && Date.now() >= endDate.getTime()) {
        active = false;
      }
    }
    console.log(
      candyMachine.state.goLiveDate.toNumber() + currentShift <=
        new Date().getTime() / 1000
    );
    if (
      isPresale &&
      candyMachine.state.goLiveDate &&
      candyMachine.state.goLiveDate.toNumber() + currentShift <=
        new Date().getTime() / 1000
    ) {
      setIsPresale((candyMachine.state.isPresale = false));
    }

    setIsActive((candyMachine.state.isActive = active));
  };

  return (
    <>
      <SimpleDialog open={open} onClose={handleClose} />
      {/* <header>
                <div className="logo">
                    <img src="img/icon.png" alt="Logo" />
                </div>
                <div className="social-list"></div>
            </header> */}
      <div className="main-screen">
        <div className="main-area">
          <div className="main-area__right">
            <h2 className="right-title">Bull Club NFT</h2>
            <div className="right-list">
              <li>
                <div className="text">
                  Bull Club NFT is a community-first PFP project on Solana,
                  backed by strong and ownable branding, cheeky storytelling,
                  innovative long-term utility, and a passionate community of
                  free-thinking degens.
                  <br />
                  Bull Club NFT has fallen under the trance of a mysterious yet
                  charismatic leader, Chorles, but don't worry… it's definitely
                  not a cult.
                  <br />
                  <br />
                  <font size={5}>
                    <b>
                      MINT YOUR <font color="red">FREE</font> Bull Club NFT!
                    </b>
                  </font>
                </div>
              </li>
            </div>
            <div className="price">
              <div className="add-input-remove">
                <input type="text" id="total" defaultValue={1} readOnly="" />
                {/* <a href="##" className="minus-btn">
                  -
                </a>
                <a href="##" className="plus-btn">
                  +
                </a> */}
              </div>
              <div className="price-box">
                <div id="price-total">
                  <span>
                    {isWhitelistUser && discountPrice
                      ? `◎ ${formatNumber.asNumber(discountPrice)}`
                      : candyMachine?.state?.price
                      ? `◎ ${formatNumber.asNumber(candyMachine?.state?.price)}`
                      : "-"}{" "}
                    SOL + Fees
                  </span>
                </div>
                <div>1 NFT max per transaction</div>
                <div>5 NFT max per wallet</div>
              </div>
            </div>
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
              flexWrap="wrap"
            >
              <Stack color="#ffffff" alignItems="flex-start">
                {" "}
                {isActive && endDate && Date.now() < endDate.getTime() ? (
                  <>
                    <MintCountdown
                      key="endSettings"
                      date={getCountdownDate(candyMachine, currentShift)}
                      style={{ justifyContent: "flex-end" }}
                      status="COMPLETED"
                      onComplete={() => toggleMintButton(currentShift)}
                    />
                    <Typography
                      variant="caption"
                      textAlign="center"
                      display="block"
                      style={{ fontWeight: "bold" }}
                      width="160px"
                    >
                      TO END OF MINT
                    </Typography>
                  </>
                ) : (
                  <>
                    <MintCountdown
                      key="goLive"
                      date={getCountdownDate(candyMachine, currentShift)}
                      style={{ justifyContent: "flex-end" }}
                      status={
                        candyMachine?.state?.isSoldOut ||
                        (endDate && Date.now() > endDate.getTime())
                          ? "COMPLETED"
                          : isPresale
                          ? "PRESALE"
                          : "LIVE"
                      }
                      onComplete={() => toggleMintButton(currentShift)}
                    />
                    {isPresale &&
                      candyMachine.state.goLiveDate &&
                      candyMachine.state.goLiveDate.toNumber() + currentShift >
                        new Date().getTime() / 1000 && (
                        <Typography
                          variant="caption"
                          align="center"
                          display="block"
                          style={{ fontWeight: "bold" }}
                        >
                          UNTIL PUBLIC MINT
                        </Typography>
                      )}
                  </>
                )}
              </Stack>
              <Stack>
                <Box
                  style={{
                    color: "#ffffff",
                    fontWeight: "bold",
                    textShadow:
                      "1px 1px 2px rgb(165, 22, 22), 0 0 1em blue, 0 0 0.2em blue",
                    fontSize: "20px",
                  }}
                >
                  TOKENS MINTED
                </Box>

                <Box
                  style={{
                    color: "#ffffff",
                    fontWeight: "bold",
                    textShadow:
                      "1px 1px 2px rgb(165, 22, 22), 0 0 1em blue, 0 0 0.2em blue",
                    fontSize: "20px",
                  }}
                >
                  {candyMachine?.state.itemsRedeemed
                    ? candyMachine?.state.itemsRedeemed
                    : "0"}{" "}
                  /{" "}
                  {candyMachine?.state.itemsAvailable
                    ? candyMachine?.state.itemsAvailable
                    : "2500"}
                </Box>
              </Stack>
            </Stack>

            <div className="button-box">
              <div id="root" className="cl-root">
                <main>
                  <div className="sc-dlfnuX bJgQKs">
                    {!wallet.connected ? (
                      <ConnectButton
                        sx={{ border: "none", backgroundColor: "#ffffff" }}
                        className="btn-pap btn-pap-primary"
                      >
                        <span>Select Wallet</span>
                      </ConnectButton>
                    ) : (
                      <MintButton
                        candyMachine={candyMachine}
                        isMinting={isUserMinting}
                        setIsMinting={(val) => setIsUserMinting(val)}
                        onMint={onMint}
                        isActive={
                          isActive ||
                          (isPresale && isWhitelistUser && isValidBalance)
                        }
                      />
                    )}
                  </div>
                </main>
              </div>
              <img src="/assets/solana.png" alt="solana" />
            </div>
          </div>
          <div className="main-area__left">
            <div className="slider-area">
              <img className="animation" src={img_5} alt="jpeg" />
            </div>
          </div>
        </div>
      </div>
      <Snackbar
        open={alertState.open}
        autoHideDuration={6000}
        onClose={() => setAlertState({ ...alertState, open: false })}
      >
        <Alert
          onClose={() => setAlertState({ ...alertState, open: false })}
          severity={alertState.severity}
        >
          {alertState.message}
        </Alert>
      </Snackbar>
    </>
  );
};
const getCountdownDate = (candyMachine, currentShift) => {
  if (
    candyMachine?.state?.isActive &&
    candyMachine?.state?.endSettings?.endSettingType.date
  ) {
    return toDate(candyMachine?.state?.endSettings.number);
  }

  return toDate(
    candyMachine?.state?.goLiveDate
      ? new anchor.BN(candyMachine?.state?.goLiveDate.toNumber() + currentShift)
      : candyMachine?.state?.isPresale
      ? new anchor.BN(new Date().getTime() / 1000)
      : undefined
  );
};

export default Main;
