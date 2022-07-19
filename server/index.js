require("dotenv").config();
const mongoose = require("mongoose");
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const path = require("path");
const PORT = process.env.PORT || 4000;
const UserSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
  },
  private: {
    type: Boolean,
    default: false,
  },
  nftBought: {
    type: Number,
    default: 0,
  },
  saleDate: {
    type: Date,
    default: new Date().toISOString(),
  },
});
const User = mongoose.model("User", UserSchema);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static("./build"));

app.post("/user", async (req, res) => {
  try {
    const { walletAddress, nftBought } = req.body;

    const user = await User.findOne({ walletAddress });

    if (user) {
      user.nftBought = nftBought;
      await user.save();
    } else {
      const newUser = new User({
        walletAddress,
        nftBought,
      });

      await newUser.save();
    }

    res.status(200).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
});
app.post("/privateUser", async (req, res) => {
  try {
    const { walletAddress, nftBought } = req.body;

    const user = await User.findOne({ walletAddress });

    if (user) {
      user.nftBought = nftBought;
      user.private = true;
      await user.save();
    } else {
      const newUser = new User({
        walletAddress,
        nftBought,
        private: true,
      });

      await newUser.save();
    }

    res.status(200).end();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
});

app.get("/user/:walletAddress", async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await User.findOne({ walletAddress });

    if (user) {
      res.status(200).json(user);
    } else {
      res.status(404).send("User Not Found");
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error });
  }
});

app.get("/*", function (req, res) {
  res.sendFile(path.join(__dirname, "./build/index.html"), function (err) {
    if (err) {
      res.status(500).send(err);
    }
  });
});
mongoose
  .connect(
    "mongodb+srv://aqib5176:Aqibjutt1@amazon.lfxfm.mongodb.net/myFirstDatabase?retryWrites=true&w=majority"
  )
  .then(() => {
    app.listen(PORT, () => console.log(`Server is Listening on PORT 4000`));
  })
  .catch((error) => {
    console.error(error);
  });
