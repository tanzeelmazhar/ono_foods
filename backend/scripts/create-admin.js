import "dotenv/config";
import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

const { ADMIN_BOOTSTRAP_EMAIL: email, ADMIN_BOOTSTRAP_NAME: name, ADMIN_BOOTSTRAP_PHONE: phone, ADMIN_BOOTSTRAP_PASSWORD: password } = process.env;
if (!email || !name || !phone || !password || password.length < 12) {
  console.error("Set the ADMIN_BOOTSTRAP_* values and use a 12+ character password for this one-time command.");
  process.exitCode = 1;
} else {
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      "INSERT INTO users (full_name, phone_number, email, password_hash, role) " +
      "VALUES ($1, $2, $3, $4, 'admin') " +
      "ON CONFLICT (email) DO NOTHING RETURNING user_id",
      [name.trim(), phone.trim(), email.trim().toLowerCase(), passwordHash]
    );
    if (!result.rowCount) throw new Error("This email is already in use. Choose a new owner email; no existing account was changed.");
    console.log("Admin account ready (user " + result.rows[0].user_id + "). Remove bootstrap credentials from the environment.");
  } catch (error) {
    console.error("Admin setup failed:", error.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
