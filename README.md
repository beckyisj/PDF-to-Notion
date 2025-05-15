# PDF to Notion Converter

This project is a browser-based tool that lets you upload a PDF, extract its text, use Gemini AI to summarize or structure the content, and send the result directly to a Notion database as a series of blocks.

## Features

- **PDF Upload:** Upload any PDF from your browser.
- **Text Extraction:** The backend extracts raw text from the PDF using `pdf.js-extract`.
- **AI Structuring:** The extracted text is sent to Gemini AI, which returns either plain text or (if needed) structured content. The backend robustly extracts usable text from any Gemini output.
- **Frontend Preview:** See the AI-processed text in the browser before sending to Notion.
- **Notion Integration:** With one click, send the processed content to your Notion database, where each paragraph becomes a Notion block.
- **Robust Error Handling:** Handles various Gemini output formats and backend/frontend errors gracefully.

## How it Works

1. **Upload a PDF** via the web UI.
2. **Text is extracted** on the backend.
3. **Text is sent to Gemini AI** for summarization/structuring.
4. **AI response is post-processed** to ensure plain text is extracted, even if Gemini returns JSON or Markdown.
5. **Preview the result** in the browser.
6. **Send to Notion**: Each paragraph is sent as a Notion block to your chosen database.

## Setup

1. Clone the repo and install dependencies:
   ```bash
   git clone https://github.com/beckyisj/PDF-to-Notion.git
   cd PDF-to-Notion
   npm install
   ```
2. Add your API keys and config to `.env`:
   ```env
   GEMINI_API_KEY=your_gemini_api_key_here
   NOTION_API_KEY=your_notion_api_key_here
   NOTION_DATABASE_ID=your_notion_database_id_here
   PORT=3000
   ```
3. Start the backend:
   ```bash
   node server.js
   ```
4. Start the frontend:
   ```bash
   npm run dev
   ```
5. Open [http://localhost:5173](http://localhost:5173) in your browser.

## Future Improvements

- **Better Formatting:**
  - Detect and preserve headings, bullet points, and numbered lists more accurately.
  - Allow user to choose between summary and full extraction.
- **UI/UX Enhancements:**
  - Clean up and modernize the frontend UI.
  - Add loading indicators, error messages, and success notifications.
  - Show a preview of the Notion page structure before sending.
- **Advanced AI Features:**
  - Let users select between different Gemini models or prompt templates.
  - Add support for other LLMs (Claude, OpenAI, etc) as fallback.
- **PDF Parsing:**
  - Remove repeated headers/footers automatically.
  - Support multi-column PDFs and scanned documents (OCR).
- **Notion Integration:**
  - Allow selection of target database/page from the UI.
  - Support for updating existing Notion pages.
- **Deployment:**
  - Add Docker support and deployment instructions.
  - Enable authentication for multi-user use.

## Deployment Options

You can deploy this project using a variety of platforms:

- **Vercel**: Great for frontend (React/Vite) hosting. Backend can be deployed as a serverless function or on a separate service.
- **Netlify**: Similar to Vercel, ideal for static frontend. Backend can be hosted separately.
- **Render**: Supports both static sites (frontend) and web services (backend Node.js/Express) with easy deployment from GitHub.
- **Heroku**: Simple platform for deploying Node.js backends. You can also serve the frontend from the backend or use Heroku's static buildpacks.
- **Docker**: Containerize both frontend and backend for deployment to any cloud provider (AWS, GCP, Azure, DigitalOcean, etc). Great for production and scaling.
- **Other Cloud Providers**: You can deploy the backend to AWS EC2, Google Cloud Run, Azure App Service, etc., and the frontend to S3/CloudFront, Firebase Hosting, or similar.

**Note:** For production, you may want to serve the frontend as static files from the backend, or use a reverse proxy (like Nginx) to route requests. Make sure to secure your API keys and environment variables.

## Contributing
Pull requests and suggestions are welcome!

## License
MIT
