import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs/promises';
import { PDFExtract } from 'pdf.js-extract';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const pdfExtract = new PDFExtract();
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Initialize Gemini
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

// Enable CORS with more permissive settings for development
app.use(cors({
  origin: '*', // Allow all origins in development
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Add request logging
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  console.log('Headers:', req.headers);
  next();
});

// Add this near the top of the file after other middleware
app.use(express.json());

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      await fs.mkdir('uploads', { recursive: true });
      cb(null, 'uploads/');
    } catch (error) {
      console.error('Error creating uploads directory:', error);
      cb(error, null);
    }
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// Serve static files from the 'public' directory
app.use(express.static('public'));

// Helper to clean text and detect bullets
function cleanText(text) {
  return text
    .replace(/[\uE000-\uF8FF]/g, '') // Remove private use area symbols (like )
    .replace(/[•●◦‣▪–—]/g, '•')     // Normalize various bullet symbols to a standard bullet
    .replace(/[\u25A0-\u25FF]/g, '•') // Replace geometric shapes with bullet
    .replace(/ {2,}/g, ' ')           // Collapse multiple spaces
    .trim();
}
function isBulletLine(text) {
  return /^([•\-\u25A0-\u25FF]|[\uE000-\uF8FF])/.test(text);
}

// Function to parse PDF and detect headers/footers and headings
async function parsePDF(filePath) {
  try {
    console.log('Reading PDF file from:', filePath);
    const dataBuffer = await fs.readFile(filePath);
    console.log('PDF file read successfully, size:', dataBuffer.length);
    
    const data = await pdfExtract.extract(filePath);
    console.log('PDF parsed successfully, pages:', data.pages.length);

    // Extract raw text from all pages
    const text = data.pages.map(page => page.content.map(item => item.str).join(' ')).join('\n\n');
    console.log('Extracted text:', text.slice(0, 500)); // Log first 500 chars for debug

    return {
      text,
      metadata: {
        pageCount: data.pages.length,
        info: data.info || {},
        title: data.info && data.info.Title ? data.info.Title : null
      }
    };
  } catch (error) {
    console.error('Error parsing PDF:', error);
    throw error;
  }
}

// File upload endpoint
app.post('/api/upload', upload.single('pdf'), async (req, res) => {
  console.log('Received upload request:', req.file);
  
  if (!req.file) {
    console.log('No file received');
    return res.status(400).json({ error: 'No file uploaded' });
  }
  
  try {
    // Parse the uploaded PDF
    const parsedData = await parsePDF(req.file.path);
    console.log('Sending parsedContent:', parsedData);
    console.log('parsedContent.text:', parsedData.text);
    console.log('PDF parsed successfully');
    
    // Send back both the file info and parsed content
    res.json({ 
      message: 'File uploaded and parsed successfully', 
      file: req.file,
      parsedContent: parsedData
    });
  } catch (error) {
    console.error('Error processing PDF:', error);
    res.status(500).json({ 
      error: 'Error processing PDF',
      details: error.message 
    });
  }
});

// Endpoint to create a Notion page from parsed PDF content
app.post('/api/notion/create', express.json(), async (req, res) => {
  try {
    const { title, blocks } = req.body;
    if (!title || !blocks || !Array.isArray(blocks)) {
      return res.status(400).json({ error: 'Missing title or blocks' });
    }

    // Convert our block structure to Notion block format
    const notionBlocks = blocks.map(block => {
      if (block.type === 'heading_2') {
        return {
          object: 'block',
          type: 'heading_2',
          heading_2: {
            rich_text: [
              {
                type: 'text',
                text: { content: block.text }
              }
            ]
          }
        };
      } else if (block.type === 'bulleted_list_item') {
        return {
          object: 'block',
          type: 'bulleted_list_item',
          bulleted_list_item: {
            rich_text: [
              {
                type: 'text',
                text: { content: block.text }
              }
            ]
          }
        };
      } else {
        // Default to paragraph
        return {
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: block.text }
              }
            ]
          }
        };
      }
    });

    // Create a new page in the Notion database
    const response = await notion.pages.create({
      parent: { database_id: NOTION_DATABASE_ID },
      properties: {
        Name: {
          title: [
            {
              text: { content: title }
            }
          ]
        }
      },
      children: notionBlocks.slice(0, 100) // Notion API limit: 100 blocks per request
    });

    res.json({ message: 'Page created in Notion!', notionResponse: response });
  } catch (error) {
    console.error('Error creating Notion page:', error);
    res.status(500).json({ error: 'Failed to create Notion page', details: error.message });
  }
});

// Add a test endpoint
app.get('/api/test', (req, res) => {
  console.log('Test endpoint hit');
  res.json({ message: 'Server is running!' });
});

// Update the AI endpoint to use Gemini
app.post('/api/ai/structure', express.json(), async (req, res) => {
  try {
    const { text } = req.body;
    console.log('Received text for AI structuring:', text?.slice(0, 500)); // Log first 500 chars
    
    if (!text) {
      console.log('No text received in request body');
      return res.status(400).json({ error: 'Missing text' });
    }

    if (!process.env.GEMINI_API_KEY) {
      console.error('Gemini API key is not configured');
      return res.status(500).json({ error: 'Gemini API key is not configured' });
    }

    const prompt = `
You are an AI assistant that converts unstructured text into a JSON array of Notion blocks.

• Detect headings: lines beginning with #, ##, ### → heading_1, heading_2, heading_3.  
• Detect bullet lists: lines starting with -, *, or + → bulleted_list_item.  
• Detect numbered lists: lines starting with 1., 2., etc. → numbered_list_item.  
• Everything else → paragraph.  
• Merge consecutive lines of the same type into one block.  
• Preserve inline styling: **bold**, *italic*, \`code\`, [links](url).

Always output **only** the JSON array—no markdown, no explanations.

Text:
${text}
`;

    console.log('Sending prompt to Gemini...');
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-1.5-pro-latest',
      contents: prompt,
    });
    const responseContent = geminiResponse.candidates[0].content.parts[0].text;
    console.log('Raw Gemini response:', responseContent?.slice(0, 500));
    
    let blocks;
    try {
      // Remove Markdown code block markers if present
      const cleaned = responseContent.replace(/```json|```/g, '').trim();
      const parsed = JSON.parse(cleaned);
      blocks = Array.isArray(parsed) ? parsed : (parsed.blocks || []);
    } catch (error) {
      console.error('Failed to parse Gemini response as JSON:', error);
      return res.status(500).json({ error: 'Failed to parse AI response', raw: responseContent });
    }

    console.log('Extracted blocks:', blocks.slice(0, 3)); // Log first 3 blocks
    res.json({ blocks, raw: responseContent });
  } catch (error) {
    console.error('AI structuring error:', error);
    res.status(500).json({ error: 'Failed to structure blocks', details: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    error: 'Internal server error',
    details: err.message 
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
  console.log('CORS enabled for all origins');
  console.log('Uploads directory:', path.resolve(__dirname, 'uploads'));
}); 