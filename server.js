// server.js
import express from "express";
import bodyParser from "body-parser";
import session from "express-session";
import passport from "passport";
import env from "dotenv";

env.config();

const app = express();
const port = 3000;

import authRoutes from "./routes/authRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import roadmapRoutes from "./routes/roadmapRoutes.js";

// SESSION CONFIG
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    rolling: true, // Reset 5 minutes after each interaction
    cookie: { maxAge: 10 * 60 * 1000 } 
  })
);

// Body parsers - ADD JSON SUPPORT
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // ADD THIS LINE for API calls
app.use(express.static("public"));

// Passport config
import "./config/passport.js";
app.use(passport.initialize());
app.use(passport.session()); // UNCOMMENT THIS LINE

app.use("/", authRoutes);
app.use("/", dashboardRoutes);
app.use("/", roadmapRoutes);

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});