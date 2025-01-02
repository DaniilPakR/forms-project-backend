const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/comments/add", async (req, res) => {
  try {
    const { form_id, user_id, comment_text, user_name } = req.body;

    if (!form_id || !user_id || !comment_text || !user_name) {
      return res.status(400).json({ error: "Form ID, User ID, and comment text are required." });
    }

    await pool.query(
      `INSERT INTO comments (form_id, user_id, comment_text, user_name, commented_at) 
       VALUES ($1, $2, $3, $4, NOW())`,
      [form_id, user_id, comment_text, user_name]
    );

    res.status(201).json({ message: "Comment added successfully." });
  } catch (error) {
    console.error("Error adding comment:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.delete("/comments/delete", async (req, res) => {
  try {
    const { comment_id } = req.body;

    // Validate input
    if (!comment_id) {
      return res.status(400).json({ error: "Comment ID is required." });
    }

    // Delete the like
    const result = await pool.query(
      `DELETE FROM comments 
       WHERE comment_id = $1`,
      [comment_id]
    );

    if (result.rowCount > 0) {
      return res.status(200).json({ message: "Comment deleted successfully." });
    } else {
      return res.status(404).json({ error: "Comment not found." });
    }
  } catch (error) {
    console.error("Error deleting comment:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/comments/:formId", async (req, res) => {
  try {
    const { formId } = req.params;

    if (!formId) {
      return res.status(400).json({ error: "Form ID is required." });
    }

    // Query the comments table for the given form_id
    const comments = await pool.query(
      `SELECT * FROM comments WHERE form_id = $1 ORDER BY commented_at DESC`,
      [formId]
    );

    if (comments.rows.length === 0) {
      return res.status(404).json({ message: "No comments found for this form." });
    }

    res.status(200).json(comments.rows);
  } catch (error) {
    console.error("Error fetching comments:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});


module.exports = router;