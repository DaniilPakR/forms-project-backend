const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");
const errorHandler = require("./errorHandler");
const authRoutes = require("./routes/authRoutes");
const formsUpdatingRoutes = require("./routes/formsUpdatingRoutes");
const usersRoutes = require("./routes/usersRoutes");
const homeFetchFormsRoutes = require("./routes/homeFetchFormsRoutes");
const tagsRoutes = require("./routes/tagsRoutes");
const filledFormsRoutes = require("./routes/filledFormsRoutes");
const likesRoutes = require("./routes/likesRoutes");
const commentsRoutes = require("./routes/commentsRoutes");
const searchRoutes = require("./routes/searchRoutes");

const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: 'dmi1xxumf',
  api_key: '352349418547498',
  api_secret: 'KJwBO8rslvNxv59SmwHKwSyV4vg',
});

// middleware
const allowedOrigins = [
  "http://localhost:3000", // Development
  "https://forms-project-c77c1.web.app", // Production
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
  })
);
app.use(express.json());

app.use(authRoutes);
app.use(formsUpdatingRoutes);
app.use(usersRoutes);
app.use(homeFetchFormsRoutes);
app.use(tagsRoutes);
app.use(filledFormsRoutes);
app.use(likesRoutes);
app.use(commentsRoutes);
app.use(searchRoutes);

app.get('/tables', async (req, res) => {
  try {
    const result = await pool.query(
      `
      SELECT table_name, column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
      `
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).send('Error fetching table structures');
  }
});

app.delete('/delete-image', async (req, res) => {
  const { public_id } = req.body;

  if (!public_id) {
    return res.status(400).json({ error: 'Public ID is required' });
  }

  try {
    const result = await cloudinary.uploader.destroy(public_id);
    res.status(200).json({ message: 'Image deleted successfully', result });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete image', details: error });
  }
});

app.use(errorHandler);

app.listen(5000, () => {
  console.log("Server has started on port 5000")
});