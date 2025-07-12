const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

// Load environment variables
dotenv.config();

// stripe require
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

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

    const registeredCampsCollection = client
      .db("medical_camp_management")
      .collection("registered_camps");

    const paymentsCollection = client
      .db("medical_camp_management")
      .collection("payments");

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

    // Get all camps (no pagination)
    app.get("/camps", async (req, res) => {
      try {
        const camps = await campsCollection.find().toArray();
        res.send(camps);
      } catch (error) {
        console.error("Error fetching camps:", error);
        res.status(500).send({ message: "Failed to fetch camps" });
      }
    });

    // get all camps data (pagination)
    app.get("/camps/paginated", async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 9;
        const skip = (page - 1) * limit;

        // Fetch paginated camps and total count
        const [camps, totalCount] = await Promise.all([
          campsCollection
            .find()
            .sort({ created_at: -1 }) // newest camps first
            .skip(skip)
            .limit(limit)
            .toArray(),

          campsCollection.estimatedDocumentCount(),
        ]);

        res.send({
          camps,
          totalPages: Math.ceil(totalCount / limit),
          currentPage: page,
        });
      } catch (error) {
        console.error("Pagination error:", error);
        res.status(500).send({ message: "Failed to fetch paginated camps" });
      }
    });

    // GET top 6 popular camps
    app.get("/camps/popular", async (req, res) => {
      try {
        const camps = await campsCollection
          .find()
          .sort({ participantCount: -1 })
          .limit(6)
          .toArray();

        res.send(camps);
      } catch (err) {
        res.status(500).send({ error: "Failed to fetch popular camps" });
      }
    });

    // Get single camp details by ID
    app.get("/camp-details/:id", async (req, res) => {
      const campId = req.params.id;

      if (!ObjectId.isValid(campId)) {
        return res.status(400).send({ message: "Invalid camp ID" });
      }

      try {
        const camp = await campsCollection.findOne({
          _id: new ObjectId(campId),
        });

        if (!camp) {
          return res.status(404).send({ message: "Camp not found" });
        }

        res.send(camp);
      } catch (error) {
        console.error("Error fetching camp details:", error);
        res.status(500).send({ message: "Failed to fetch camp details" });
      }
    });

    // delete camp
    app.delete("/delete-camp/:campId", async (req, res) => {
      const campId = req.params.campId;

      const query = { _id: new ObjectId(campId) };

      const result = await campsCollection.deleteOne(query);
      res.send(result);
    });

    // update camp information
    app.put("/update-camp/:campId", async (req, res) => {
      const updateCamp = req.body;
      const campId = req.params.campId;

      const query = { _id: new ObjectId(campId) };
      updateCamp.updated_at = new Date().toISOString();
      const updateDoc = {
        $set: updateCamp,
      };

      const result = await campsCollection.updateOne(query, updateDoc);
      res.send(result);
    });

    // save registered camps in the database
    app.post("/camp-registration", async (req, res) => {
      try {
        const registrationData = req.body;
        const { campId } = registrationData;
        console.log(campId);

        if (!campId) {
          return res.status(400).send({ error: "campId is required" });
        }

        registrationData.registered_at = new Date().toISOString();
        registrationData.payment_status = "unpaid";
        registrationData.confirmation_status = "pending";

        // 1. Insert registration data
        const result = await registeredCampsCollection.insertOne(
          registrationData
        );

        // 2. Update participant count in campsCollection
        await campsCollection.updateOne(
          { _id: new ObjectId(campId) },
          { $inc: { participantCount: 1 } }
        );

        res.send(result);
      } catch (error) {
        console.error("Registration error:", error);
        res.status(500).send({ error: "Registration failed" });
      }
    });

    // GET registered camps
    app.get("/camps-registered", async (req, res) => {
      const result = await registeredCampsCollection
        .find()
        .sort({ registered_at: -1 })
        .toArray();

      res.send(result);
    });

    // Cancel registered camp by ID
    app.delete("/cancel-registration/:id", async (req, res) => {
      const registrationId = req.params.id;
      const campId = req.query.campId;

      if (!ObjectId.isValid(registrationId) || !ObjectId.isValid(campId)) {
        return res.status(400).send({ message: "Invalid ID(s)" });
      }

      try {
        // 1. Delete the registration
        const deleteResult = await registeredCampsCollection.deleteOne({
          _id: new ObjectId(registrationId),
        });

        // 2. Decrement participant count
        await campsCollection.updateOne(
          { _id: new ObjectId(campId) },
          { $inc: { participantCount: -1 } }
        );

        res.send(deleteResult);
      } catch (error) {
        console.error("Cancellation error:", error);
        res.status(500).send({ error: "Failed to cancel registration" });
      }
    });

    // get registered camps by user email
    app.get("/registered-camps", async (req, res) => {
      const email = req.query.email;

      const result = await registeredCampsCollection
        .find({ email })
        .sort({ registered_at: -1 })
        .toArray();

      res.send(result);
    });

    // GET camp for payment
    app.get("/registered-camp/:campId", async (req, res) => {
      const campId = req.params.campId;

      if (!ObjectId.isValid(campId)) {
        return res.status(400).send({ message: "Invalid camp ID" });
      }

      try {
        const query = { _id: new ObjectId(campId) };
        const result = await registeredCampsCollection.findOne(query);

        if (!result) {
          return res.status(404).send({ message: "Camp not found" });
        }

        res.send(result);
      } catch (error) {
        console.error("Error fetching camp for payment:", error);
        res.status(500).send({ message: "Server error" });
      }
    });

    // create payment intent
    app.post("/create-payment-intent", async (req, res) => {
      const amountInCents = req.body.amountInCents;
      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amountInCents,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.json({ clientSecret: paymentIntent.client_secret });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    // GET payment history
    app.get("/payments", async (req, res) => {
      const userEmail = req.query.email;
      const query = userEmail ? { email: userEmail } : {};
      const options = { sort: { paid_at: -1 } };

      const result = await paymentsCollection.find(query, options).toArray();
      res.send(result);
    });

    // create payments history
    app.post("/payments", async (req, res) => {
      const { campId, email, amount, paymentMethod, transactionId } = req.body;

      if (!campId || !email || !amount) {
        return res
          .status(400)
          .send({ message: "campId, email and amount are required" });
      }

      // update payment_status
      const updateResult = await registeredCampsCollection.updateOne(
        {
          _id: new ObjectId(campId),
        },
        { $set: { payment_status: "paid", confirmation_status: "confirmed" } }
      );

      if (updateResult.modifiedCount === 0) {
        return res
          .status(404)
          .send({ message: "camp not found or already paid" });
      }

      // insert payments history
      const paymentDoc = {
        campId,
        email,
        fees: amount,
        paymentMethod,
        transactionId,
        paid_at: new Date().toISOString(),
      };

      const paymentResult = await paymentsCollection.insertOne(paymentDoc);

      res.status(201).send({
        message: "payment history created and camp mark as paid",
        insertedId: paymentResult.insertedId,
      });
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
