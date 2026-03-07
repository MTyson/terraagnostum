
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

// Try to load from .env.local
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    console.log("Loading .env.local");
    dotenv.config({ path: envPath });
} else {
    console.log(".env.local not found");
}

console.log("GEMINI_API_KEY exists:", !!process.env.GEMINI_API_KEY);
if (process.env.GEMINI_API_KEY) {
    console.log("Key starts with:", process.env.GEMINI_API_KEY.substring(0, 5));
}
