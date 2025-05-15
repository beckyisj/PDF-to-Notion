import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs/promises';
import fsSync from 'fs';
import { PDFExtract } from 'pdf.js-extract';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';
import { GoogleGenAI, Type } from '@google/genai';

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

    // Convert plain text to Notion paragraph blocks (one per paragraph)
    let notionBlocks = [];
    if (typeof blocks === 'string') {
      notionBlocks = blocks
        .split('\n\n')
        .filter(p => p.trim())
        .map(paragraph => ({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: paragraph.trim() }
              }
            ]
          }
        }));
    } else if (Array.isArray(blocks)) {
      // fallback for legacy: treat as before
      notionBlocks = blocks.map(block => {
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
    }

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
Ignore all previous instructions and formatting.
You are to output ONLY plain text, with each paragraph separated by a blank line.
Do NOT use JSON, Markdown, or code blocks. Do NOT use {, }, [, ], or any symbols except normal text and newlines.
Do NOT include any metadata, headers, or extra information.

Example of desired output:
This is the first paragraph. It contains the main ideas and key points.

This is the second paragraph. It continues with more information.

This is the third paragraph. Each paragraph should be separated by a blank line.

Text to process:
${text}
`;

    console.log('Sending prompt to Gemini...');
    const response = await ai.models.generateContent({
      model: 'gemini-1.5-pro',
      contents: prompt,
      generationConfig: {
        temperature: 0.1,  // Lower temperature for more consistent output
      }
    });
    
    // Get the raw text content from candidates
    let responseContent = '';
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        responseContent = candidate.content.parts[0].text;
      }
    }
    
    console.log('Raw Gemini response content:', responseContent);
    // Post-process: try to extract text from JSON if present
    let plainText = responseContent;
    try {
      // Remove code block markers if present
      let cleaned = responseContent;
      if (cleaned.trim().startsWith('```')) {
        cleaned = cleaned.split('\n').filter(line => !line.trim().startsWith('```')).join('\n');
      }
      // Try to parse as JSON
      const parsed = JSON.parse(cleaned);
      // If it's an array of blocks, extract all 'content' fields
      if (Array.isArray(parsed)) {
        plainText = parsed
          .map(block => {
            // Notion-style: block.paragraph.rich_text[0].text.content
            if (block.paragraph && block.paragraph.rich_text && block.paragraph.rich_text[0] && block.paragraph.rich_text[0].text) {
              return block.paragraph.rich_text[0].text.content;
            }
            // Heading-style: block.heading_1.rich_text[0].text.content
            if (block.heading_1 && block.heading_1.rich_text && block.heading_1.rich_text[0] && block.heading_1.rich_text[0].text) {
              return block.heading_1.rich_text[0].text.content;
            }
            // Fallback: block.text
            if (block.text) return block.text;
            return '';
          })
          .filter(Boolean)
          .join('\n\n');
      }
    } catch (err) {
      // If parsing fails, just use the raw responseContent
      plainText = responseContent;
    }
    res.json({ text: plainText });
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