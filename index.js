const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion } = require("mongodb");

// Load environment variables
dotenv.config();

// create app and port
const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// database management
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.0d3a79b.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // database collections
    const usersCollection = client
      .db("medical_camp_management")
      .collection("users");

    const campsCollection = client
      .db("medical_camp_management")
      .collection("camps");

    // save users information in the database
    app.post("/users", async (req, res) => {
      const email = req.body.email;
      const user = req.body;
      try {
        const emailExist = await usersCollection.findOne({ email });
        if (emailExist) {
          return res
            .status(200)
            .send({ message: "user already exists", inserted: false });
        }

        const result = await usersCollection.insertOne(user);
        res.send(result);
      } catch (error) {
        res.status(500).send({ message: "Failed to post user data", error });
      }
    });

    // update user last sign in time
    app.patch("/users", async (req, res) => {
      const { email, lastSignInTime } = req.body;

      const query = { email };

      const updateDoc = {
        $set: {
          last_signin_time: lastSignInTime,
        },
      };

      const result = await usersCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // update user profile information
    app.patch("/users/profile-update", async (req, res) => {
      try {
        const { email, name, photo } = req.body;

        if (!email) {
          return res.status(400).send({ error: "Email is required." });
        }

        const query = { email };
        const updateDoc = {
          $set: {},
        };

        // Only update fields that were sent
        if (name) updateDoc.$set.name = name;
        if (photo) updateDoc.$set.photo = photo;

        if (Object.keys(updateDoc.$set).length === 0) {
          return res.status(400).send({ error: "No fields to update." });
        }

        const result = await usersCollection.updateOne(query, updateDoc);
        res.send(result);
      } catch (error) {
        console.error("Profile update error:", error);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // get user role
    app.get("/users/role/:email", async (req, res) => {
      const email = req.params.email;

      if (!email) {
        return res.status(400).send({ error: "Email is required" });
      }

      try {
        const user = await usersCollection.findOne(
          { email },
          { projection: { role: 1 } }
        );

        if (!user) {
          return res.status(404).send({ error: "User not found" });
        }

        res.send({ role: user.role || "participant" }); // default to "participant" if role is undefined
      } catch (err) {
        console.error("Error getting user role:", err);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // save camps information in the database
    app.post("/camps", async (req, res) => {
      const campData = req.body;
      campData.created_at = new Date().toISOString();

      const result = await campsCollection.insertOne(campData);
      res.send(result);
    });

    // get all camps data
    app.get("/camps", async (req, res) => {
      const result = await campsCollection
        .find()
        .sort({ created_at: -1 })
        .toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

// Basic health check
app.get("/", (req, res) => {
  res.send("Medical Camp Management System Server is running successfully!");
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});
