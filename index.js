const express = require("express");
const app = express();
const cors = require("cors");
const pool = require("./db");
const errorHandler = require("./errorHandler");

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


// register user

app.post("/auth/register", async (req, res) => {
  console.log("Hi", req.body)
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
        is_admin: user.rows[0].is_admin,
        is_blocked: user.rows[0].is_blocked,
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
      titlemarkdown,
      tags,
      usersWithAccess,
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
      const { questionTitle, questionType, required, options, showInResults, is_with_score, score, correct_answer } = question;

      const newQuestion = await pool.query(
        `INSERT INTO questions (form_id, question_text, question_type, is_required, position, show_in_results) 
         VALUES ($1, $2, $3, $4, $5, $6) 
         RETURNING question_id`,
        [formId, questionTitle, questionType, required, questions.indexOf(question) + 1, showInResults]
      );

      const questionId = newQuestion.rows[0].question_id;

      // Insert options into the "answer_options" table
      if (options && options.length > 0) {
        for (const option of options) {
          await pool.query(
            `INSERT INTO answer_options (question_id, option_text, position, is_correct) 
             VALUES ($1, $2, $3, $4)`,
            [questionId, option.optionText, option.position, option.is_correct]
          );
        }
      }
    }

    if (tags && tags.length > 0) {
      // Fetch existing tags from the database
      const existingTags = await pool.query(
        `SELECT tag_id, tag_text FROM tags WHERE tag_text = ANY($1)`,
        [tags]
      );

      const existingTagIds = existingTags.rows.map((tag) => tag.tag_id);
      const existingTagTexts = existingTags.rows.map((tag) => tag.tag_text);

      // Find new tags that don't exist in the database
      const newTags = tags.filter((tag) => !existingTagTexts.includes(tag));

      // Insert new tags into the database
      let newTagIds = [];
      if (newTags.length > 0) {
        const newTagInserts = await Promise.all(
          newTags.map((tag) =>
            pool.query(`INSERT INTO tags (tag_text) VALUES ($1) RETURNING tag_id`, [tag])
          )
        );
        newTagIds = newTagInserts.map((result) => result.rows[0].tag_id);
      }

      // Combine existing and new tag IDs
      const allTagIds = [...existingTagIds, ...newTagIds];

      // Link tags to the form in the form_tags table
      await Promise.all(
        allTagIds.map((tagId) =>
          pool.query(
            `INSERT INTO form_tags (form_id, tag_id) VALUES ($1, $2)`,
            [formId, tagId]
          )
        )
      );
    }

    // If the form is not public, insert access control records
    if (!isPublic) {
      if (!usersWithAccess || usersWithAccess.length === 0) {
        return res
          .status(400)
          .json({ error: "usersWithAccess is required for non-public forms." });
      }

      // Fetch user IDs for provided emails
      const userFetchResults = await Promise.all(
        usersWithAccess.map((email) =>
          pool.query(`SELECT user_id FROM users WHERE user_email = $1`, [email])
        )
      );

      const userIds = userFetchResults
        .map((result) => result.rows[0]?.user_id)
        .filter(Boolean);

      if (userIds.length !== usersWithAccess.length) {
        return res
          .status(400)
          .json({ error: "Some user emails do not correspond to registered users." });
      }

      // Insert rows into the access_control table
      await Promise.all(
        userIds.map((userId) =>
          pool.query(`INSERT INTO access_control (form_id, user_id) VALUES ($1, $2)`, [formId, userId])
        )
      );
    }

    res.status(201).json({ message: "Form created successfully.", formId });
  } catch (error) {
    console.error("Error creating form:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});


app.get("/users/get", async (req, res) => {
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
app.delete("/users/delete", async (req, res) => {
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
app.post("/users/action", async (req, res) => {
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

app.get("/latest/forms", async (req, res) => {
  try {
    const latestForms = await pool.query(
      `SELECT title, description, image, page_id 
       FROM forms 
       WHERE is_public = true
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    res.json({
      message: "Latest forms retrieved successfully",
      forms: latestForms.rows
    });
  } catch (error) {
    console.error("Error fetching latest forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/popular/forms", async (req, res) => {
  try {
    const popularForms = await pool.query(
      `SELECT f.form_id, f.title, f.description, f.image, f.page_id, COUNT(ff.filled_form_id) AS filled_count
       FROM forms f
       LEFT JOIN filled_forms ff ON f.form_id = ff.form_id
       WHERE f.is_public = true
       GROUP BY f.form_id, f.title, f.description, f.image, f.page_id
       ORDER BY filled_count DESC
       LIMIT 5`
    );

    res.json({
      message: "Top 5 popular forms retrieved successfully",
      forms: popularForms.rows
    });
  } catch (error) {
    console.error("Error fetching popular forms:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Route to get all tags sorted alphabetically
app.get("/tags", async (req, res) => {
  try {
    const tags = await pool.query(
      `SELECT tag_id, tag_text 
       FROM tags 
       ORDER BY tag_text ASC`
    );

    res.json({
      message: "Tags retrieved successfully",
      tags: tags.rows
    });
  } catch (error) {
    console.error("Error fetching tags:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

// Route to get all forms associated with a specific tag
app.get("/tags/:tagId/forms", async (req, res) => {
  const { tagId } = req.params;

  try {
    const forms = await pool.query(
      `SELECT f.form_id, f.title, f.description, f.image, f.page_id 
       FROM forms f
       INNER JOIN form_tags ft ON f.form_id = ft.form_id
       WHERE ft.tag_id = $1 AND f.is_public = true
       ORDER BY f.created_at DESC`,
      [tagId]
    );

    res.json({
      message: "Forms retrieved successfully for the tag",
      forms: forms.rows
    });
  } catch (error) {
    console.error("Error fetching forms for the tag:", error.message);
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

    const query = `
      SELECT 
        f.form_id, f.page_id, f.title, f.description, f.descriptionMarkdown, f.topic, f.image, f.is_public, 
        f.creator_id, f.created_at, f.updated_at, f.titlemarkdown,
        q.question_id, q.question_text, q.question_type, q.is_required, q.position, q.show_in_results,
        ao.option_id, ao.option_text, ao.position AS option_position, ao.is_correct,
        ft.tag_id, t.tag_text,
        ac.user_id AS access_user_id, u.user_email AS access_user_email, u.user_name AS access_user_name
      FROM forms f
      LEFT JOIN questions q ON f.form_id = q.form_id
      LEFT JOIN answer_options ao ON q.question_id = ao.question_id
      LEFT JOIN form_tags ft ON f.form_id = ft.form_id
      LEFT JOIN tags t ON ft.tag_id = t.tag_id
      LEFT JOIN access_control ac ON f.form_id = ac.form_id
      LEFT JOIN users u ON ac.user_id = u.user_id
      WHERE f.page_id = $1
      ORDER BY q.position, ao.position;
    `;

    const result = await pool.query(query, [page_id]);

    if (!result.rows.length) {
      return res.status(404).json({ error: "No form found with the given page_id" });
    }

    const form = {
      form_id: result.rows[0].form_id,
      page_id: result.rows[0].page_id,
      title: result.rows[0].title,
      description: result.rows[0].description,
      descriptionMarkdown: result.rows[0].descriptionmarkdown,
      topic: result.rows[0].topic,
      image_url: result.rows[0].image,
      is_public: result.rows[0].is_public,
      creator_id: result.rows[0].creator_id,
      created_at: result.rows[0].created_at,
      updated_at: result.rows[0].updated_at,
      titleMarkdown: result.rows[0].titlemarkdown,
      tags: [],
      questions: [],
      users_with_access: []
    };

    const questionMap = {};
    const tagMap = {};
    const accessMap = {};

    for (const row of result.rows) {
      // Process questions and options
      if (row.question_id) {
        if (!questionMap[row.question_id]) {
          questionMap[row.question_id] = {
            question_id: row.question_id,
            question_text: row.question_text,
            question_type: row.question_type,
            is_required: row.is_required,
            position: row.position,
            show_in_results: row.show_in_results,
            options: []
          };
          form.questions.push(questionMap[row.question_id]);
        }
        if (row.option_id) {
          questionMap[row.question_id].options.push({
            option_id: row.option_id,
            option_text: row.option_text,
            position: row.option_position,
            is_correct: row.is_correct
          });
        }
      }

      // Process tags
      if (row.tag_id && !tagMap[row.tag_id]) {
        tagMap[row.tag_id] = true;
        form.tags.push({ tag_id: row.tag_id, tag_text: row.tag_text });
      }

      // Process access control
      if (!form.is_public && row.access_user_id && !accessMap[row.access_user_id]) {
        accessMap[row.access_user_id] = true;
        form.users_with_access.push({
          user_id: row.access_user_id,
          user_email: row.access_user_email,
          user_name: row.access_user_name
        });
      }
    }

    res.json(form);
  } catch (err) {
    console.error("Error fetching form data:", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.put("/forms/edit/:formId", async (req, res) => {
  console.log("Test")
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
    pageId,
    tags, // array of tags as strings
    accessControlUsers
  } = req.body;

  try {

    await pool.query("BEGIN");

    // Update the `forms` table
    await pool.query(
      `UPDATE forms 
       SET title = $1, titlemarkdown = $2, description = $3, descriptionmarkdown = $4, topic = $5, image = $6, 
           is_public = $7, updated_at = NOW(), page_id = $8
       WHERE form_id = $9`,
      [title, titlemarkdown, description, descriptionmarkdown, topic, imageUrl, isPublic, pageId, formId]
    );

    if (isPublic) {
      // If public, remove all users from the access_control table for this form
      await pool.query(`DELETE FROM access_control WHERE form_id = $1`, [formId]);
    } else {
      // Fetch existing access control users
      const existingAccessUsers = await pool.query(
        `SELECT user_id FROM access_control WHERE form_id = $1`,
        [formId]
      );
      const existingUserIds = existingAccessUsers.rows.map(row => row.user_id);

      // Determine users to add and remove
      const usersToAdd = accessControlUsers.filter(userId => !existingUserIds.includes(userId));
      const usersToRemove = existingUserIds.filter(userId => !accessControlUsers.includes(userId));

      // Add new users
      for (const userId of usersToAdd) {
        await pool.query(
          `INSERT INTO access_control (form_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [formId, userId]
        );
      }

      // Remove users no longer authorized
      if (usersToRemove.length > 0) {
        await pool.query(
          `DELETE FROM access_control WHERE form_id = $1 AND user_id = ANY($2::uuid[])`,
          [formId, usersToRemove]
        );
      }
    }

    // Fetch existing form_tags
    const existingTags = await pool.query(
      `SELECT t.tag_id, t.tag_text 
       FROM tags t 
       INNER JOIN form_tags ft ON ft.tag_id = t.tag_id 
       WHERE ft.form_id = $1`,
      [formId]
    );

    const existingTagNames = existingTags.rows.map(tag => tag.tag_text);

    // Identify tags to add and remove
    const newTags = tags.filter(tag => !existingTagNames.includes(tag));
    const removedTags = existingTagNames.filter(tag => !tags.includes(tag));

    // Remove tags not in the update
    if (removedTags.length > 0) {
      await pool.query(
        `DELETE FROM form_tags 
         WHERE form_id = $1 AND tag_id IN (
           SELECT tag_id FROM tags WHERE tag_text = ANY($2::text[])
         )`,
        [formId, removedTags]
      );
    }

    // Add new tags
    for (const tagName of newTags) {
      let tagId;

      // Check if the tag already exists
      const existingTag = await pool.query(
        `SELECT tag_id FROM tags WHERE tag_text = $1`,
        [tagName]
      );

      if (existingTag.rows.length > 0) {
        tagId = existingTag.rows[0].tag_id;
      } else {
        // Create the tag if it doesn't exist
        const newTag = await pool.query(
          `INSERT INTO tags (tag_text) VALUES ($1) RETURNING tag_id`,
          [tagName]
        );
        tagId = newTag.rows[0].tag_id;
      }

      // Link the tag to the form
      await pool.query(
        `INSERT INTO form_tags (form_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [formId, tagId]
      );
    }

    // Process questions (remains the same)
    const existingQuestions = await pool.query(
      `SELECT question_id FROM questions WHERE form_id = $1`,
      [formId]
    );
    const existingQuestionIds = existingQuestions.rows.map(q => q.question_id);
    const updatedQuestionIds = questions.map(q => q.questionId).filter(Boolean);

    const questionsToDelete = existingQuestionIds.filter(qId => !updatedQuestionIds.includes(qId));
    if (questionsToDelete.length > 0) {
      await pool.query(`DELETE FROM questions WHERE question_id = ANY($1::int[])`, [questionsToDelete]);
    }

    for (const question of questions) {
      const { questionId, questionTitle, questionType, required, options, showInResults } = question;

      let newQuestionId = questionId;

      if (questionId && existingQuestionIds.includes(questionId)) {
        await pool.query(
          `UPDATE questions 
           SET question_text = $1, question_type = $2, is_required = $3, position = $4, show_in_results = $5 
           WHERE question_id = $6`,
          [questionTitle, questionType, required, questions.indexOf(question) + 1, showInResults, questionId]
        );
      } else {
        const newQuestion = await pool.query(
          `INSERT INTO questions (form_id, question_text, question_type, is_required, position, show_in_results) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING question_id`,
          [formId, questionTitle, questionType, required, questions.indexOf(question) + 1, showInResults]
        );
        newQuestionId = newQuestion.rows[0].question_id;
      }

      const existingOptions = await pool.query(
        `SELECT option_id FROM answer_options WHERE question_id = $1`, [newQuestionId]
      );
      const existingOptionIds = existingOptions.rows.map(o => o.option_id);
      const updatedOptionIds = options.map(o => o.optionId).filter(Boolean);

      const optionsToDelete = existingOptionIds.filter(oId => !updatedOptionIds.includes(oId));
      if (optionsToDelete.length > 0) {
        await pool.query(`DELETE FROM answer_options WHERE option_id = ANY($1::int[])`, [optionsToDelete]);
      }

      for (const option of options) {
        const { optionId, optionText, is_correct } = option;

        if (optionId && existingOptionIds.includes(optionId)) {
          await pool.query(
            `UPDATE answer_options 
             SET option_text = $1, position = $2, is_correct = $3
             WHERE option_id = $4`,
            [optionText, options.indexOf(option) + 1, is_correct, optionId]
          );
        } else {
          await pool.query(
            `INSERT INTO answer_options (question_id, option_text, position, is_correct) 
             VALUES ($1, $2, $3, $4)`,
            [newQuestionId, optionText, options.indexOf(option) + 1, is_correct]
          );
        }
      }
    }

    await pool.query("COMMIT");
    res.status(200).json({ message: "Form updated successfully." });
  } catch (error) {
    console.error("Error updating formss:", error.message);
    await pool.query("ROLLBACK");
    res.status(500).json({ error: "Internal server error." });
  }
});

app.put("/forms/edits/:formId", async (req, res) => {
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
    pageId,
    tags, // array of tags as strings
    accessControlUsers
  } = req.body;

  try {

    await pool.query("BEGIN");

    // Update the `forms` table
    await pool.query(
      `UPDATE forms 
       SET title = $1, titlemarkdown = $2, description = $3, descriptionmarkdown = $4, topic = $5, image = $6, 
           is_public = $7, updated_at = NOW(), page_id = $8
       WHERE form_id = $9`,
      [title, titlemarkdown, description, descriptionmarkdown, topic, imageUrl, isPublic, pageId, formId]
    );

    if (isPublic) {
      // If public, remove all users from the access_control table for this form
      await pool.query(`DELETE FROM access_control WHERE form_id = $1`, [formId]);
    } else {
      // Fetch existing access control users
      const existingAccessUsers = await pool.query(
        `SELECT user_id FROM access_control WHERE form_id = $1`,
        [formId]
      );
      const existingUserIds = existingAccessUsers.rows.map(row => row.user_id);

      // Determine users to add and remove
      const usersToAdd = accessControlUsers.filter(userId => !existingUserIds.includes(userId));
      const usersToRemove = existingUserIds.filter(userId => !accessControlUsers.includes(userId));

      // Add new users
      for (const userId of usersToAdd) {
        await pool.query(
          `INSERT INTO access_control (form_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [formId, userId]
        );
      }

      // Remove users no longer authorized
      if (usersToRemove.length > 0) {
        await pool.query(
          `DELETE FROM access_control WHERE form_id = $1 AND user_id = ANY($2::uuid[])`,
          [formId, usersToRemove]
        );
      }
    }

    // Fetch existing form_tags
    const existingTags = await pool.query(
      `SELECT t.tag_id, t.tag_text 
       FROM tags t 
       INNER JOIN form_tags ft ON ft.tag_id = t.tag_id 
       WHERE ft.form_id = $1`,
      [formId]
    );

    const existingTagNames = existingTags.rows.map(tag => tag.tag_text);

    // Identify tags to add and remove
    const newTags = tags.filter(tag => !existingTagNames.includes(tag));
    const removedTags = existingTagNames.filter(tag => !tags.includes(tag));

    // Remove tags not in the update
    if (removedTags.length > 0) {
      await pool.query(
        `DELETE FROM form_tags 
         WHERE form_id = $1 AND tag_id IN (
           SELECT tag_id FROM tags WHERE tag_text = ANY($2::text[])
         )`,
        [formId, removedTags]
      );
    }

    // Add new tags
    for (const tagName of newTags) {
      let tagId;

      // Check if the tag already exists
      const existingTag = await pool.query(
        `SELECT tag_id FROM tags WHERE tag_text = $1`,
        [tagName]
      );

      if (existingTag.rows.length > 0) {
        tagId = existingTag.rows[0].tag_id;
      } else {
        // Create the tag if it doesn't exist
        const newTag = await pool.query(
          `INSERT INTO tags (tag_text) VALUES ($1) RETURNING tag_id`,
          [tagName]
        );
        tagId = newTag.rows[0].tag_id;
      }

      // Link the tag to the form
      await pool.query(
        `INSERT INTO form_tags (form_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [formId, tagId]
      );
    }

    // Process questions (remains the same)
    const existingQuestions = await pool.query(
      `SELECT question_id FROM questions WHERE form_id = $1`,
      [formId]
    );
    const existingQuestionIds = existingQuestions.rows.map(q => q.question_id);
    const updatedQuestionIds = questions.map(q => q.questionId).filter(Boolean);

    const questionsToDelete = existingQuestionIds.filter(qId => !updatedQuestionIds.includes(qId));
    if (questionsToDelete.length > 0) {
      await pool.query(`DELETE FROM questions WHERE question_id = ANY($1::int[])`, [questionsToDelete]);
    }

    for (const question of questions) {
      const { questionId, questionTitle, questionType, required, options, showInResults } = question;

      let newQuestionId = questionId;

      if (questionId && existingQuestionIds.includes(questionId)) {
        await pool.query(
          `UPDATE questions 
           SET question_text = $1, question_type = $2, is_required = $3, position = $4, show_in_results = $5 
           WHERE question_id = $6`,
          [questionTitle, questionType, required, questions.indexOf(question) + 1, showInResults, questionId]
        );
      } else {
        const newQuestion = await pool.query(
          `INSERT INTO questions (form_id, question_text, question_type, is_required, position, show_in_results) 
           VALUES ($1, $2, $3, $4, $5, $6) 
           RETURNING question_id`,
          [formId, questionTitle, questionType, required, questions.indexOf(question) + 1, showInResults]
        );
        newQuestionId = newQuestion.rows[0].question_id;
      }

      const existingOptions = await pool.query(
        `SELECT option_id FROM answer_options WHERE question_id = $1`, [newQuestionId]
      );
      const existingOptionIds = existingOptions.rows.map(o => o.option_id);
      const updatedOptionIds = options.map(o => o.optionId).filter(Boolean);

      const optionsToDelete = existingOptionIds.filter(oId => !updatedOptionIds.includes(oId));
      if (optionsToDelete.length > 0) {
        await pool.query(`DELETE FROM answer_options WHERE option_id = ANY($1::int[])`, [optionsToDelete]);
      }

      for (const option of options) {
        const { optionId, optionText, is_correct } = option;

        if (optionId && existingOptionIds.includes(optionId)) {
          await pool.query(
            `UPDATE answer_options 
             SET option_text = $1, position = $2, is_correct = $3
             WHERE option_id = $4`,
            [optionText, options.indexOf(option) + 1, is_correct, optionId]
          );
        } else {
          await pool.query(
            `INSERT INTO answer_options (question_id, option_text, position, is_correct) 
             VALUES ($1, $2, $3, $4)`,
            [newQuestionId, optionText, options.indexOf(option) + 1, is_correct]
          );
        }
      }
    }

    await pool.query("COMMIT");
    res.status(200).json({ message: "Form updated successfully." });
  } catch (error) {
    console.error("Error updating formss:", error.message);
    await pool.query("ROLLBACK");
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

app.get("/filled-forms/:user_id", async (req, res) => {
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

app.delete("/forms/delete/:formId", async (req, res) => {
  try {
    const { formId } = req.params;

    if (!formId) {
      return res.status(400).json({ error: "Form ID is required." });
    }

    // Delete all answer options associated with questions of the form
    await pool.query(
      `DELETE FROM answer_options 
       WHERE question_id IN (
         SELECT question_id FROM questions WHERE form_id = $1
       )`,
      [formId]
    );

    // Delete all questions associated with the form
    await pool.query(
      `DELETE FROM questions 
       WHERE form_id = $1`,
      [formId]
    );

    // Delete the form itself
    await pool.query(
      `DELETE FROM forms 
       WHERE form_id = $1`,
      [formId]
    );

    res.status(200).json({ message: "Form deleted successfully." });
  } catch (error) {
    console.error("Error deleting form:", error.message);
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

app.get("/forms/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query) {
      return res.status(400).json({ error: "Search query is required." });
    }

    const searchTerm = `%${query}%`; // For LIKE operator with partial matching

    // Query to search across multiple tables for related data
    const searchResults = await pool.query(
      `
      SELECT DISTINCT f.form_id, f.page_id, f.title
      FROM forms f
      LEFT JOIN questions q ON f.form_id = q.form_id
      LEFT JOIN answer_options ao ON q.question_id = ao.question_id
      LEFT JOIN form_tags ft ON f.form_id = ft.form_id
      LEFT JOIN tags t ON ft.tag_id = t.tag_id
      WHERE 
        f.title ILIKE $1 OR
        f.description ILIKE $1 OR
        f.topic ILIKE $1 OR
        q.question_text ILIKE $1 OR
        ao.option_text ILIKE $1 OR
        t.tag_text ILIKE $1
      `,
      [searchTerm]
    );

    if (searchResults.rows.length === 0) {
      return res.status(404).json({ message: "No matching forms found." });
    }

    res.status(200).json(searchResults.rows);
  } catch (error) {
    console.error("Error fetching search results:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/forms/:formId/details", async (req, res) => {
  try {
    const { formId } = req.params;

    if (!formId) {
      return res.status(400).json({ error: "Form ID is required." });
    }

    // 1. Check if a filled form exists for the given form_id
    const filledForms = await pool.query(
      `SELECT * FROM filled_forms WHERE form_id = $1`,
      [formId]
    );

    if (filledForms.rows.length === 0) {
      return res.status(404).json({ message: "No filled form exists for this form." });
    }

    const filledForm = filledForms.rows[0];

    // 2. Retrieve form details
    const form = await pool.query(
      `SELECT * FROM forms WHERE form_id = $1`,
      [formId]
    );

    // 3. Retrieve questions for the form
    const questions = await pool.query(
      `SELECT * FROM questions WHERE form_id = $1`,
      [formId]
    );

    // 4. Retrieve answer options for each question
    const questionIds = questions.rows.map((q) => q.question_id);
    let answerOptions = [];

    if (questionIds.length > 0) {
      const placeholders = questionIds.map((_, index) => `$${index + 1}`).join(", ");
      const query = `SELECT * FROM answer_options WHERE question_id IN (${placeholders})`;
      answerOptions = await pool.query(query, questionIds);
    }

    // 5. Retrieve answers for the filled form
    const answers = await pool.query(
      `SELECT * FROM answers WHERE filled_form_id = $1`,
      [filledForm.filled_form_id]
    );

    // 6. Retrieve comments for the form
    const comments = await pool.query(
      `SELECT * FROM comments WHERE form_id = $1`,
      [formId]
    );

    // 7. Retrieve likes for the form
    const likes = await pool.query(
      `SELECT * FROM likes WHERE form_id = $1`,
      [formId]
    );

    // 8. Combine all data into a single response
    const result = {
      filledForm,
      filledForms: filledForms.rows,
      form: form.rows[0],
      questions: questions.rows,
      answerOptions: answerOptions.rows,
      answers: answers.rows,
      comments: comments.rows,
      likes: likes.rows
    };

    res.status(200).json(result);
  } catch (error) {
    console.error("Error fetching form details:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/tags/search", async (req, res) => {
  try {
    const { query } = req.query;

    if (!query || query.trim() === "") {
      return res.status(400).json({ error: "Query parameter is required." });
    }

    const tags = await pool.query(
      `SELECT * FROM tags WHERE tag_text ILIKE $1`,
      [`%${query}%`]
    );

    res.status(200).json(tags.rows);
  } catch (error) {
    console.error("Error searching tags:", error.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

app.get("/users/search", async (req, res) => {
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

app.use(errorHandler)

app.listen(5000, () => {
  console.log("Server has started on port 5000")
});