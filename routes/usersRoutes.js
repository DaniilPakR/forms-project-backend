const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/users/get", async (req, res) => {
  try {
    const users = await pool.query("SELECT * FROM users")
    res.json({
      message: "Users retrieved successfully",
      users: users.rows
    })
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error." });
  }
})

// DELETE route for deleting users
router.delete("/users/delete", async (req, res) => {
  const { userIds } = req.body;

  if (!userIds || !Array.isArray(userIds)) {
    return res.status(400).json({ error: "Invalid or missing user IDs." });
  }

  try {
    const query = `
      DELETE FROM users
      WHERE user_id = ANY($1::uuid[])
    `;
    await pool.query(query, [userIds]);

    res.json({ message: "Users successfully deleted." });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Existing POST route for actions
router.post("/users/action", async (req, res) => {
  const { userIds, action } = req.body;

  // Valid actions
  const actionsMap = {
    block: { column: "is_blocked", value: true },
    unblock: { column: "is_blocked", value: false },
    make_admin: { column: "is_admin", value: true },
    remove_admin: { column: "is_admin", value: false },
  };

  const selectedAction = actionsMap[action];

  if (!selectedAction) {
    return res.status(400).json({ error: "Invalid action specified." });
  }

  try {
    const { column, value } = selectedAction;
    const query = `
      UPDATE users
      SET ${column} = $1, updated_at = NOW()
      WHERE user_id = ANY($2::uuid[])
    `;
    await pool.query(query, [value, userIds]);

    res.json({ message: `Users successfully ${action}ed.` });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/users/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ error: "Query parameter is required." });
    }

    const users = await pool.query(
      `SELECT * FROM users WHERE user_name ILIKE $1 OR user_email ILIKE $1`,
      [`%${query}%`]
    );

    res.status(200).json(users.rows);
  } catch (error) {
    console.error("Error searching tags:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;