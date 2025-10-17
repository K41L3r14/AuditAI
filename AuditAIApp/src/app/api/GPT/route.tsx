// src/app/api/GPT/route.js
import { NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs"; // use Node runtime for the official SDK

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});
