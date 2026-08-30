import bcrypt from "bcrypt";
import mongoose from "mongoose";

const SALT_ROUNDS = 12;

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
  },
  { timestamps: true },
);

// Kept on the model, not scattered across controllers — anywhere a password
// needs checking or hashing goes through here, so the hashing scheme is a
// one-line change if it ever needs to.
userSchema.statics.hashPassword = function (plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
};

userSchema.methods.verifyPassword = function (plainPassword) {
  return bcrypt.compare(plainPassword, this.passwordHash);
};

// Never let a User document be serialized with its hash inside — every JSON
// response (req.user, API payloads) goes through res.json(), which calls
// toJSON() implicitly.
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.passwordHash;
    return ret;
  },
});

export const User = mongoose.model("User", userSchema);
