import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs/promises';
import { PDFExtract } from 'pdf.js-extract';
import { Client as NotionClient } from '@notionhq/client';
import dotenv from 'dotenv';
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const pdfExtract = new PDFExtract();
const notion = new NotionClient({ auth: process.env.NOTION_API_KEY });
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;

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

    // Collect first and last lines from each page for header/footer detection
    const firstLines = [];
    const lastLines = [];
    const allPageBlocks = [];
    const allLines = [];

    // Gather all lines and font sizes for heading detection
    data.pages.forEach(page => {
      const lines = [];
      let currentLine = [];
      let lastY = null;
      page.content.forEach(item => {
        if (lastY !== null && Math.abs(item.y - lastY) > 2) {
          if (currentLine.length) lines.push(currentLine);
          currentLine = [];
        }
        currentLine.push(item);
        lastY = item.y;
      });
      if (currentLine.length) lines.push(currentLine);
      if (lines.length) {
        firstLines.push(lines[0].map(i => i.str).join(' ').trim());
        lastLines.push(lines[lines.length - 1].map(i => i.str).join(' ').trim());
      }
      allLines.push(...lines.map(line => line.map(i => i.str).join(' ').trim()));
      allPageBlocks.push(lines);
    });

    // Detect repeated headers/footers
    function findRepeatedLines(linesArr) {
      const counts = {};
      linesArr.forEach(line => {
        if (line) counts[line] = (counts[line] || 0) + 1;
      });
      const threshold = Math.floor(data.pages.length * 0.7);
      return Object.entries(counts)
        .filter(([line, count]) => count >= threshold)
        .map(([line]) => line);
    }
    const repeatedHeaders = findRepeatedLines(firstLines);
    const repeatedFooters = findRepeatedLines(lastLines);

    // Build structured blocks, skipping repeated headers/footers
    const blocks = [];
    allPageBlocks.forEach(lines => {
      lines.forEach(line => {
        const text = line.map(i => i.str).join(' ').trim();
        if (!text) return;
        if (repeatedHeaders.includes(text) || repeatedFooters.includes(text)) return;
        // Heading detection: if most items in line have the max font size on the page, treat as heading
        const fontSizes = line.map(i => i.height);
        const maxFont = Math.max(...fontSizes);
        const isHeading = fontSizes.filter(h => h === maxFont).length >= Math.floor(line.length * 0.7) && maxFont > 10;
        if (isHeading) {
          blocks.push({ type: 'heading_2', text });
        } else {
          blocks.push({ type: 'paragraph', text });
        }
      });
    });

    // Optionally, add header/footer once at top/bottom
    if (repeatedHeaders.length) {
      blocks.unshift({ type: 'paragraph', text: repeatedHeaders[0] });
    }
    if (repeatedFooters.length) {
      blocks.push({ type: 'paragraph', text: repeatedFooters[0] });
    }

    return {
      blocks,
      metadata: {
        pageCount: data.pages.length,
        info: data.info || {},
        repeatedHeaders,
        repeatedFooters
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