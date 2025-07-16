// require and load environment variables
const dotenv = require("dotenv");
dotenv.config();

const express = require("express");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const admin = require("firebase-admin");

// create app and port
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: ["https://medical-camp-management-f1b2a.web.app"],
    credentials: true,
  })
);
app.use(express.json());

// firebase
const decoded = Buffer.from(
  process.env.FB_ADMIN_SERVICE_KEY,
  "base64"
).toString("utf8");
const serviceAccount = JSON.parse(decoded);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

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

    const feedbacksCollection = client
      .db("medical_camp_management")
      .collection("feedbacks");

    // custom middleware for secure API
    // verify user
    const verifyUser = async (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      const token = authHeader.split(" ")[1];
      if (!token) {
        return res.status(401).send({ message: "unauthorized access" });
      }

      // verify the token
      try {
        const decoded = await admin.auth().verifyIdToken(token);
        req.decoded = decoded;
        next();
      } catch (error) {
        return res.status(403).send({ message: "forbidden access" });
      }
    };

    // verify organizer
    const verifyOrganizer = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email };

      const user = await usersCollection.findOne(query);
      if (!user || user.role !== "organizer") {
        return res.status(403).send({ message: "forbidden access" });
      }

      next();
    };

    // save users information
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
    app.get("/users/role/", verifyUser, async (req, res) => {
      const email = req.query.email;

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

        res.send({ role: user.role || "participant" });
      } catch (err) {
        console.error("Error getting user role:", err);
        res.status(500).send({ error: "Internal Server Error" });
      }
    });

    // save camps information
    app.post("/camps", verifyUser, verifyOrganizer, async (req, res) => {
      const campData = req.body;
      campData.created_at = new Date().toISOString();

      const result = await campsCollection.insertOne(campData);
      res.send(result);
    });

    // get all camps (no pagination) for organizer
    app.get("/camps", verifyUser, verifyOrganizer, async (req, res) => {
      try {
        const camps = await campsCollection.find().toArray();
        res.send(camps);
      } catch (error) {
        console.error("Error fetching camps:", error);
        res.status(500).send({ message: "Failed to fetch camps" });
      }
    });

    // get all camps (pagination)
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

    // get top 6 popular camps
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

    // get single camp details by ID
    app.get("/camp-details/:campId", async (req, res) => {
      const campId = req.params.campId;

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
    app.delete(
      "/delete-camp/:campId",
      verifyUser,
      verifyOrganizer,
      async (req, res) => {
        const campId = req.params.campId;

        const query = { _id: new ObjectId(campId) };

        const result = await campsCollection.deleteOne(query);
        res.send(result);
      }
    );

    // update camp information
    app.patch(
      "/update-camp/:campId",
      verifyUser,
      verifyOrganizer,
      async (req, res) => {
        const updateCamp = req.body;
        const campId = req.params.campId;

        const query = { _id: new ObjectId(campId) };
        updateCamp.updated_at = new Date().toISOString();
        const updateDoc = {
          $set: updateCamp,
        };

        const result = await campsCollection.updateOne(query, updateDoc);
        res.send(result);
      }
    );

    // save registered camps
    app.post("/camp-registration", verifyUser, async (req, res) => {
      try {
        const registrationData = req.body;
        const { campId } = registrationData;

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

    // get registered camps
    app.get(
      "/camps-registered",
      verifyUser,
      verifyOrganizer,
      async (req, res) => {
        const result = await registeredCampsCollection
          .find()
          .sort({ registered_at: -1 })
          .toArray();

        res.send(result);
      }
    );

    // delete registered camp by ID
    app.delete("/cancel-registration/:id", verifyUser, async (req, res) => {
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
    app.get("/registered-camps", verifyUser, async (req, res) => {
      const email = req.query.email;

      const result = await registeredCampsCollection
        .find({ email })
        .sort({ registered_at: -1 })
        .toArray();

      res.send(result);
    });

    // get camp for payment
    app.get("/registered-camp/:campId", verifyUser, async (req, res) => {
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
    app.post("/create-payment-intent", verifyUser, async (req, res) => {
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

    // create payments history
    app.post("/payments", verifyUser, async (req, res) => {
      const { campId, campName, email, amount, paymentMethod, transactionId } =
        req.body;

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
        campName,
        email,
        fees: amount,
        payment_status: "paid",
        confirmation_status: "confirmed",
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

    // get payment history
    app.get("/payments", verifyUser, async (req, res) => {
      const userEmail = req.query.email;
      const query = userEmail ? { email: userEmail } : {};
      const options = { sort: { paid_at: -1 } };

      const result = await paymentsCollection.find(query, options).toArray();
      res.send(result);
    });

    // save feedbacks
    app.post("/feedbacks", verifyUser, async (req, res) => {
      const feedback = req.body;

      const result = await feedbacksCollection.insertOne(feedback);
      res.send(result);
    });

    // get all feedbacks
    app.get("/feedbacks", async (req, res) => {
      const result = await feedbacksCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
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
