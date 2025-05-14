import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';
import fs from 'fs/promises';
import { PDFExtract } from 'pdf.js-extract';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;
const pdfExtract = new PDFExtract();

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

// Function to parse PDF
async function parsePDF(filePath) {
  try {
    console.log('Reading PDF file from:', filePath);
    const dataBuffer = await fs.readFile(filePath);
    console.log('PDF file read successfully, size:', dataBuffer.length);
    
    const data = await pdfExtract.extract(filePath);
    console.log('PDF parsed successfully, pages:', data.pages.length);
    
    // Extract text and metadata
    const parsedData = {
      text: data.pages.map(page => page.content.map(item => item.str).join(' ')).join('\n\n'),
      metadata: {
        pageCount: data.pages.length,
        info: data.info || {},
      },
      // Split text into pages for better structure
      pages: data.pages.map(page => page.content.map(item => item.str).join(' '))
    };
    
    return parsedData;
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