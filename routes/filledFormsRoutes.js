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
        [
          filledFormId,
          question_id,
          answer_text || null,
          JSON.stringify(answer_value) || null,
          question_type,
        ]
      );
    }

    res
      .status(201)
      .json({ message: "Form submitted successfully.", filledFormId });
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
      return res
        .status(404)
        .json({ message: "No filled forms found for this user." });
    }

    res.status(200).json({ filledForms: result.rows });
  } catch (err) {
    console.error("Error fetching filled forms:", err);
    res
      .status(500)
      .json({ error: "An error occurred while fetching filled forms." });
  }
});

router.get("/view-filled-form/:id", async (req, res) => {
  try {
    const filledFormId = req.params.id;

    // Fetch the filled form
    const filledForm = await pool.query(
      `SELECT * FROM filled_forms WHERE filled_form_id = $1`,
      [filledFormId]
    );

    const filledFormRows = filledForm.rows;

    // Fetch form data based on form_id from filled form
    const formData = await pool.query(
      `SELECT * FROM forms WHERE form_id = $1`,
      [filledFormRows[0].form_id]
    );

    // Fetch questions for the form
    const questions = await pool.query(
      `SELECT * FROM questions WHERE form_id = $1`,
      [filledFormRows[0].form_id]
    );

    const newAnswers = await pool.query(
      `SELECT * FROM answers WHERE filled_form_id = $1`,
      [filledFormId]
    );

    let answersObject = {};
    newAnswers.rows.forEach((answer) => {
      answersObject[answer.question_id] = answer;
    })

    let answersOptions = [];
    let answers = [];
    
    // Process each question and gather answer options
    for (const question of questions.rows) {
      const answerOptions = await pool.query(
        `SELECT * FROM answer_options WHERE question_id = $1`,
        [question.question_id]
      );

      const optionsArray = answerOptions.rows.map(option => ({
        option_id: option.option_id,
        option_text: option.option_text,
        is_correct: option.is_correct,
        position: option.position
      }));

      // Fetch answers for the question
      const questionAnswers = await pool.query(
        `SELECT * FROM answers WHERE question_id = $1 AND filled_form_id = $2`,
        [question.question_id, filledFormId]
      );

      // Store answers
      answers.push(questionAnswers.rows);

      answersOptions.push(optionsArray);
    }

    const result = {
      filledForm: filledFormRows[0],
      form: formData.rows[0],
      questions: questions.rows.map((question, index) => ({
        ...question,
        options: answersOptions[index], // Add answer options object
        answers: answers[index], // Add answers for the question
      })),
      answers: answersObject,
    };

    // Return the response with the modified structure
    res.json(result);
  } catch (error) {
    console.error("Error fetching filled form:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
