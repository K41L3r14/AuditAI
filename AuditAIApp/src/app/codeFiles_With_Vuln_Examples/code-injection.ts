import express, { Request, Response } from "express";
import { Pool } from "pg";

const app = express();
app.use(express.json());

const pool = new Pool({
  host: "localhost",
  user: "postgres",
  password: "password",
  database: "demo",
});

app.post("/login", async (req: Request, res: Response) => {
  const { username, password } = req.body;

  // This is intentionally vulnerable: user input is directly in the SQL string.
  const query = `
    SELECT id, username
    FROM users
    WHERE username = '${username}'
    AND password = '${password}'
  `;

  try {
    const result = await pool.query(query);

    if (result.rows.length > 0) {
      return res.json({ message: "Login successful" });
    }

    return res.status(401).json({ error: "Invalid credentials" });
  } catch (err) {
    console.error("Login error:", err);
    return res.status(500).json({ error: "Server error" });
  }
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});
