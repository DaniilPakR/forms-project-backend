const express = require("express");
const router = express.Router();
const pool = require("../db");

router.post("/filled-forms/submit", async (req, res) => {
  try {
    const { form_id, user_id, user_name, user_email, answers } = req.body;

    if (!form_id || !user_id || !answers || answers.length === 0) {
      return res
        .status(400)
        .json({ error: "Form ID, User ID, and answers are required." });
    }

    // Insert into filled_forms table
    const newFilledForm = await pool.query(
      `INSERT INTO filled_forms (form_id, user_id, user_name, user_email, filled_at) 
       VALUES ($1, $2, $3, $4, NOW()) 
       RETURNING filled_form_id`,
      [form_id, user_id, user_name, user_email]
    );

    const filledFormId = newFilledForm.rows[0].filled_form_id;

    // Insert answers into the answers table
    for (const answer of answers) {
      const { question_id, answer_text, answer_value, question_type } = answer;

      await pool.query(
        `INSERT INTO answers (filled_form_id, question_id, answer_text, answer_value, question_type, created_at  ) 
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [filledFormId, question_id, answer_text || null, JSON.stringify(answer_value) || null, question_type ]
      );
    }

    res.status(201).json({ message: "Form submitted successfully.", filledFormId });
  } catch (error) {
    console.error("Error submitting filled form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

router.get("/filled-forms/:user_id", async (req, res) => {
  const { user_id } = req.params;

  try {
    // SQL query to fetch filled forms
    const query = `
      SELECT 
        f.title, 
        f.created_at, 
        f.page_id,
        ff.filled_at
      FROM 
        filled_forms ff
      INNER JOIN 
        forms f 
      ON 
        ff.form_id = f.form_id
      WHERE 
        ff.user_id = $1;
    `;

    const result = await pool.query(query, [user_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ message: "No filled forms found for this user." });
    }

    res.status(200).json({ filledForms: result.rows });
  } catch (err) {
    console.error("Error fetching filled forms:", err);
    res.status(500).json({ error: "An error occurred while fetching filled forms." });
  }
});

module.exports = router;