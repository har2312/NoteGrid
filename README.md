# Smart Sticky Notes Board

An AI-powered Adobe Express add-on that converts messy meeting notes,
emails, and chat conversations into structured, color-coded sticky notes.

## Features
- AI extraction of tasks, decisions, and questions
- Visual sticky-note board inside Adobe Express
- Secure backend proxy (no API keys in client)
- Type-based color coding

## Tech Stack
- Adobe Express Add-ons SDK
- JavaScript
- Node.js + Express
- OpenAI API

## Local Development

### Backend
```bash
cd server
node index.js
###  Add-on
cd addon
npm run start