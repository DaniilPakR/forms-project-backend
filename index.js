const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");

// middleware
app.use(cors());
app.use(express.json());

// ROUTES 

// register user

app.post("/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    const newUser = await pool.query(
      `INSERT INTO users (user_name, user_email, user_password, created_at, updated_at) 
       VALUES ($1, $2, $3, NOW(), NOW()) 
       RETURNING *`,
      [name, email, password]
    );

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: newUser.rows[0].user_id,
        name: newUser.rows[0].user_name,
        email: newUser.rows[0].user_email,
      },
    });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(400).json({ error: "Email already exists" });
    }
    console.error("Error during registration:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// login user

// Login user
app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await pool.query(
      "SELECT * FROM users WHERE user_email = $1",
      [email]
    );

    if (user.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    if (password !== user.rows[0].user_password) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    res.json({
      message: "Login successful",
      user: {
        id: user.rows[0].user_id,
        name: user.rows[0].user_name,
        email: user.rows[0].user_email,
      },
    });
  } catch (e) {
    console.error("Error during login:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create a new form
app.post("/forms/create", async (req, res) => {
  try {
    const {
      title,
      description,
      descriptionmarkdown,
      topic,
      imageUrl,
      isPublic,
      creatorId,
      questions,
      pageId,
      titlemarkdown
    } = req.body;

    if (!title || !creatorId || !questions || questions.length === 0) {
      return res
        .status(400)
        .json({ error: "Title, creatorId, and questions are required." });
    }

    // Insert the form into the "forms" table
    const newForm = await pool.query(
      `INSERT INTO forms (title, description, descriptionmarkdown, topic, image, is_public, creator_id, created_at, updated_at, page_id, titlemarkdown) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW(), $8, $9) 
       RETURNING form_id`,
      [title, description, descriptionmarkdown, topic, imageUrl, isPublic, creatorId, pageId, titlemarkdown]
    );

    const formId = newForm.rows[0].form_id;

    // Insert questions into the "questions" table
    for (const question of questions) {
      const { questionTitle, questionType, required, options } = question;

      const newQuestion = await pool.query(
        `INSERT INTO questions (form_id, question_text, question_type, is_required, position) 
         VALUES ($1, $2, $3, $4, $5) 
         RETURNING question_id`,
        [formId, questionTitle, questionType, required, questions.indexOf(question) + 1]
      );

      const questionId = newQuestion.rows[0].question_id;

      // Insert options into the "answer_options" table
      if (options && options.length > 0) {
        for (const option of options) {
          await pool.query(
            `INSERT INTO answer_options (question_id, option_text, position) 
             VALUES ($1, $2, $3)`,
            [questionId, option.optionText, options.indexOf(option) + 1]
          );
        }
      }
    }

    res.status(201).json({ message: "Form created successfully.", formId });
  } catch (error) {
    console.error("Error creating form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Fetch forms by user ID
app.get("/forms/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    const userForms = await pool.query(
      `SELECT * FROM forms WHERE creator_id = $1 ORDER BY created_at DESC`,
      [userId]
    );

    if (userForms.rows.length === 0) {
      return res.status(404).json({ message: "No forms found for this user." });
    }

    res.json({
      message: "Forms retrieved successfully",
      forms: userForms.rows,
    });
  } catch (error) {
    console.error("Error fetching forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/eform/:page_id", async (req, res) => {
  try {
    const { page_id } = req.params;

    // Fetch form, questions, and options using the string `page_id`
    const query = `
      SELECT 
        f.form_id, f.page_id, f.title, f.description, f.descriptionMarkdown, f.topic, f.image, f.is_public, f.creator_id, f.created_at, f.updated_at, f.titlemarkdown,
        q.question_id, q.question_text, q.question_type, q.is_required, q.position, q.show_in_results,
        ao.option_id, ao.option_text, ao.position AS option_position, ao.is_correct
      FROM forms f
      LEFT JOIN questions q ON f.form_id = q.form_id
      LEFT JOIN answer_options ao ON q.question_id = ao.question_id
      WHERE f.page_id = $1
      ORDER BY q.position, ao.position;
    `;

    const result = await pool.query(query, [page_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No form found with the given page_id" });
    }

    // Transform the result into a nested structure
    const form = {
      form_id: result.rows[0].form_id,
      page_id: result.rows[0].page_id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      descriptionMarkdown: result.rows[0].descriptionmarkdown,
      topic: result.rows[0].topic,
      image_url: result.rows[0].image_url,
      is_public: result.rows[0].is_public,
      creator_id: result.rows[0].creator_id,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
      titleMarkdown: result.rows[0].titlemarkdown,
      questions: []
    };

    const questionMap = new Map();

    result.rows.forEach(row => {
      if (row.question_id) {
        if (!questionMap.has(row.question_id)) {
          questionMap.set(row.question_id, {
            question_id: row.question_id,
            question_text: row.question_text,
            question_type: row.question_type,
            is_required: row.is_required,
            position: row.position,
            show_in_results: row.show_in_results,
            options: []
          });

          form.questions.push(questionMap.get(row.question_id));
        }

        if (row.option_id) {
          questionMap.get(row.question_id).options.push({
            option_id: row.option_id,
            option_text: row.option_text,
            position: row.option_position,
            is_correct: row.is_correct
          });
        }
      }
    });

    res.json(form);
  } catch (err) {
    console.error("Error fetching form data:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/forms/edit/:formId", async (req, res) => {
  const { formId } = req.params;
  const {
    title,
    titlemarkdown,
    description,
    descriptionmarkdown,
    topic,
    imageUrl,
    isPublic,
    creatorId,
    questions,
    pageId
  } = req.body;

  try {
    if (!formId || !title || !titlemarkdown || !creatorId || !questions || questions.length === 0) {
      return res
        .status(400)
        .json({ error: "Form ID, Title, TitleMarkdown, creatorId, and questions are required." });
    }

    // Update the "forms" table
    await pool.query(
      `UPDATE forms 
       SET title = $1, titlemarkdown = $2, description = $3, descriptionmarkdown = $4, topic = $5, image = $6, 
           is_public = $7, updated_at = NOW(), page_id = $8 
       WHERE form_id = $9`,
      [title, titlemarkdown, description, descriptionmarkdown, topic, imageUrl, isPublic, pageId, formId]
    );

    // Fetch existing questions and options to identify changes
    const existingQuestions = await pool.query(
      `SELECT * FROM questions WHERE form_id = $1`, [formId]
    );
    const existingQuestionIds = existingQuestions.rows.map(q => q.question_id);

    for (const question of questions) {
      const { questionId, questionTitle, questionType, required, options } = question;

      if (questionId && existingQuestionIds.includes(questionId)) {
        // Update existing question
        await pool.query(
          `UPDATE questions 
           SET question_text = $1, question_type = $2, is_required = $3, position = $4 
           WHERE question_id = $5`,
          [questionTitle, questionType, required, questions.indexOf(question) + 1, questionId]
        );

        // Fetch existing options for this question
        const existingOptions = await pool.query(
          `SELECT * FROM answer_options WHERE question_id = $1`, [questionId]
        );
        const existingOptionIds = existingOptions.rows.map(o => o.option_id);

        for (const option of options) {
          const { optionId, optionText } = option;
          if (optionId && existingOptionIds.includes(optionId)) {
            // Update existing option
            await pool.query(
              `UPDATE answer_options 
               SET option_text = $1, position = $2 
               WHERE option_id = $3`,
              [optionText, options.indexOf(option) + 1, optionId]
            );
          } else {
            // Add new option
            await pool.query(
              `INSERT INTO answer_options (question_id, option_text, position) 
               VALUES ($1, $2, $3)`,
              [questionId, optionText, options.indexOf(option) + 1]
            );
          }
        }

        // Delete options that are not in the updated data
        const updatedOptionIds = options.map(o => o.optionId);
        for (const existingOptionId of existingOptionIds) {
          if (!updatedOptionIds.includes(existingOptionId)) {
            await pool.query(
              `DELETE FROM answer_options WHERE option_id = $1`, [existingOptionId]
            );
          }
        }
      } else {
        // Add new question
        const newQuestion = await pool.query(
          `INSERT INTO questions (form_id, question_text, question_type, is_required, position) 
           VALUES ($1, $2, $3, $4, $5) 
           RETURNING question_id`,
          [formId, questionTitle, questionType, required, questions.indexOf(question) + 1]
        );

        const newQuestionId = newQuestion.rows[0].question_id;

        // Add new options for the new question
        for (const option of options) {
          await pool.query(
            `INSERT INTO answer_options (question_id, option_text, position) 
             VALUES ($1, $2, $3)`,
            [newQuestionId, option.optionText, options.indexOf(option) + 1]
          );
        }
      }
    }

    // Delete questions that are not in the updated data
    const updatedQuestionIds = questions.map(q => q.questionId).filter(id => id);
    for (const existingQuestionId of existingQuestionIds) {
      if (!updatedQuestionIds.includes(existingQuestionId)) {
        await pool.query(
          `DELETE FROM questions WHERE question_id = $1`, [existingQuestionId]
        );
      }
    }

    res.status(200).json({ message: "Form updated successfully." });
  } catch (error) {
    console.error("Error updating form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});



app.get("/forms/search", async (req, res) => {
  try {
    const searchText = req.query.q;

    if (!searchText || searchText.trim().length < 3) {
      return res
        .status(400)
        .json({ error: "Search text is required and must be at least 3 characters." });
    }

    // SQL query to search across the forms, tags, and questions
    const searchQuery = `
      SELECT DISTINCT
          f.page_id,
          f.title,
          f.description,
          f.topic
      FROM forms f
      LEFT JOIN form_tags ft ON f.form_id = ft.form_id
      LEFT JOIN tags t ON ft.tag_id = t.tag_id
      LEFT JOIN questions q ON f.form_id = q.form_id
      WHERE
          f.is_public = TRUE AND (
              f.title ILIKE $1 OR
              f.description ILIKE $1 OR
              f.topic ILIKE $1 OR
              t.tag_text ILIKE $1 OR
              q.question_text ILIKE $1
          )
      ORDER BY f.created_at DESC;
    `;

    // Execute the query
    const searchResults = await pool.query(searchQuery, [`%${searchText}%`]);

    // Map the results to the desired response format
    const results = searchResults.rows.map((form) => ({
      link: `/fillForm/${form.page_id}`,
      title: form.title,
      description: form.description || "No description available.",
      topic: form.topic || "N/A",
    }));

    // Send the results
    res.status(200).json(results);
  } catch (error) {
    console.error("Error searching forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

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

app.post("/filled-forms/submit", async (req, res) => {
  try {
    const { form_id, user_id, answers } = req.body;

    if (!form_id || !user_id || !answers || answers.length === 0) {
      return res
        .status(400)
        .json({ error: "Form ID, User ID, and answers are required." });
    }

    // Insert into filled_forms table
    const newFilledForm = await pool.query(
      `INSERT INTO filled_forms (form_id, user_id, filled_at) 
       VALUES ($1, $2, NOW()) 
       RETURNING filled_form_id`,
      [form_id, user_id]
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

app.get("/filled-forms/:formId", async (req, res) => {
  try {
    const { formId: form_id } = req.params;

    if (!form_id) {
      return res.status(400).json({ error: "Form ID is required." });
    }

    const filledForms = await pool.query(
      `SELECT * FROM filled_forms WHERE form_id = $1`,
      [form_id]
    );

    res.status(200).json(filledForms.rows);
  } catch (error) {
    console.error("Error fetching filled forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/likes/check", async (req, res) => {
  try {
    const { userId, formId } = req.query;

    // Validate query parameters
    if (!userId || !formId) {
      return res.status(400).json({ error: "User ID and Form ID are required." });
    }

    // Query the database to check if the like exists
    const result = await pool.query(
      `SELECT 1 
       FROM likes 
       WHERE user_id = $1 AND form_id = $2`,
      [userId, formId]
    );

    // Check if a row was found
    if (result.rowCount > 0) {
      return res.status(200).json({ liked: true });
    } else {
      return res.status(200).json({ liked: false });
    }
  } catch (error) {
    console.error("Error checking like:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/likes/add", async (req, res) => {
  try {
    const { form_id, user_id } = req.body;

    if (!form_id || !user_id) {
      return res.status(400).json({ error: "Form ID and User ID are required." });
    }

    await pool.query(
      `INSERT INTO likes (form_id, user_id) 
       VALUES ($1, $2) 
       ON CONFLICT DO NOTHING`, // Prevent duplicate likes
      [form_id, user_id]
    );

    res.status(201).json({ message: "Form liked successfully." });
  } catch (error) {
    console.error("Error liking form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.delete("/likes/delete", async (req, res) => {
  try {
    const { user_id, form_id } = req.body;

    // Validate input
    if (!user_id || !form_id) {
      return res.status(400).json({ error: "User ID and Form ID are required." });
    }

    // Delete the like
    const result = await pool.query(
      `DELETE FROM likes 
       WHERE user_id = $1 AND form_id = $2`,
      [user_id, form_id]
    );

    if (result.rowCount > 0) {
      return res.status(200).json({ message: "Like deleted successfully." });
    } else {
      return res.status(404).json({ error: "Like not found." });
    }
  } catch (error) {
    console.error("Error deleting like:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.post("/comments/add", async (req, res) => {
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

app.delete("/comments/delete", async (req, res) => {
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

app.get("/comments/:formId", async (req, res) => {
  try {
    const { formId } = req.params;

    if (!formId) {
      return res.status(400).json({ error: "Form ID is required." });
    }

    // Query the comments table for the given form_id
    const comments = await pool.query(
      `SELECT * FROM comments WHERE form_id = $1 ORDER BY commented_at ASC`,
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


app.listen(5000, () => {
  console.log("Server has started on port 5000")
});