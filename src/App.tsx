import { useState } from 'react'

interface ParsedContent {
  text: string;
  metadata: {
    pageCount: number;
    info: any;
    title?: string;
  };
  blocks?: Array<{
    type: 'heading_2' | 'paragraph' | 'bulleted_list_item';
    text: string;
  }>;
}

interface UploadResponse {
  message: string;
  file: {
    originalname: string;
    size: number;
  };
  parsedContent: ParsedContent;
  error?: string;
}

// Helper to convert plain text to Notion blocks
function textToNotionBlocks(text: string) {
  // Split text into paragraphs
  const paragraphs = text.split('\n\n').filter(p => p.trim());
  
  // Convert paragraphs to blocks
  return paragraphs.map(paragraph => {
    // Check if it looks like a heading (short, ends with no period)
    if (paragraph.length < 100 && !paragraph.endsWith('.')) {
      return {
        type: 'heading_2' as const,
        text: paragraph.trim()
      };
    }
    // Check if it looks like a bullet point
    else if (paragraph.trim().startsWith('•') || paragraph.trim().startsWith('-')) {
      return {
        type: 'bulleted_list_item' as const,
        text: paragraph.trim().replace(/^[•-]\s*/, '')
      };
    }
    // Default to paragraph
    return {
      type: 'paragraph' as const,
      text: paragraph.trim()
    };
  });
}

function App() {
  const [file, setFile] = useState<File | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [parsedContent, setParsedContent] = useState<ParsedContent | null>(null)
  const [notionStatus, setNotionStatus] = useState<string | null>(null)
  const [aiRaw, setAiRaw] = useState<string | null>(null)
  const [processedBlocks, setProcessedBlocks] = useState<Array<{
    type: 'heading_2' | 'paragraph' | 'bulleted_list_item';
    text: string;
  }> | null>(null)

  const testConnection = async () => {
    try {
      const response = await fetch('http://localhost:3000/api/test')
      const data = await response.json()
      setMessage(`Server connection successful: ${data.message}`)
      setError(null)
    } catch (err) {
      setError('Cannot connect to server. Make sure it is running at http://localhost:3000')
      setMessage(null)
    }
  }

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    if (event.target.files && event.target.files[0]) {
      setFile(event.target.files[0])
      setMessage(null)
      setError(null)
      setParsedContent(null)
    }
  }

  const handleUpload = async () => {
    if (!file) return

    setIsLoading(true)
    setMessage(null)
    setError(null)
    setParsedContent(null)
    setProcessedBlocks(null)

    try {
      const formData = new FormData()
      formData.append('pdf', file)

      console.log('Attempting to upload file...')
      const response = await fetch('http://localhost:3000/api/upload', {
        method: 'POST',
        body: formData,
      }).catch(err => {
        console.error('Network error:', err)
        throw new Error(`Network error: ${err.message}. Make sure the server is running at http://localhost:3000`)
      })

      console.log('Response received:', response.status)
      const data: UploadResponse = await response.json()

      if (!response.ok) {
        throw new Error(data.error || `Server error: ${response.status}`)
      }

      if (!data.parsedContent.text) {
        setError('No text extracted from PDF to send to AI.');
        setIsLoading(false);
        return;
      }
      console.log('Parsed text:', data.parsedContent.text);
      const aiResponse = await fetch('http://localhost:3000/api/ai/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: data.parsedContent.text })
      })
      const aiData = await aiResponse.json()
      if (!aiResponse.ok) {
        throw new Error(aiData.error || 'AI structuring failed')
      }
      
      // Store the raw text response
      setAiRaw(aiData.text)
      
      // Convert text to blocks
      const blocks = textToNotionBlocks(aiData.text)
      setProcessedBlocks(blocks)
      
      setParsedContent({ ...data.parsedContent })
      setFile(null)
      // Reset the file input
      const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
      if (fileInput) fileInput.value = ''
    } catch (err) {
      console.error('Upload error:', err)
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }

  const handleSendToNotion = async () => {
    if (!parsedContent || !processedBlocks) {
      setNotionStatus('No processed content to send to Notion.');
      setIsLoading(false);
      return;
    }
    setNotionStatus(null);
    setIsLoading(true);
    try {
      const response = await fetch('http://localhost:3000/api/notion/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: parsedContent.metadata.title || file?.name || 'PDF to Notion Page',
          blocks: processedBlocks.slice(0, 100) // Notion API limit: 100 blocks per request
        })
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to create Notion page');
      }
      setNotionStatus('Page created in Notion!');
    } catch (err) {
      setNotionStatus(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 py-6 flex flex-col justify-center sm:py-12">
      <div className="relative py-3 sm:max-w-xl sm:mx-auto">
        <div className="relative px-4 py-10 bg-white shadow-lg sm:rounded-3xl sm:p-20">
          <div className="max-w-md mx-auto">
            <div className="divide-y divide-gray-200">
              <div className="py-8 text-base leading-6 space-y-4 text-gray-700 sm:text-lg sm:leading-7">
                <h1 className="text-2xl font-bold mb-8 text-center">PDF to Notion Converter</h1>
                <div className="flex flex-col items-center space-y-4">
                  <button
                    onClick={testConnection}
                    className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700"
                  >
                    Test Server Connection
                  </button>
                  
                  <input
                    type="file"
                    accept=".pdf"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-gray-500
                      file:mr-4 file:py-2 file:px-4
                      file:rounded-full file:border-0
                      file:text-sm file:font-semibold
                      file:bg-blue-50 file:text-blue-700
                      hover:file:bg-blue-100"
                  />
                  <button
                    onClick={handleUpload}
                    disabled={!file || isLoading}
                    className={`px-4 py-2 rounded-md text-white font-medium
                      ${!file || isLoading 
                        ? 'bg-gray-400 cursor-not-allowed' 
                        : 'bg-blue-600 hover:bg-blue-700'}`}
                  >
                    {isLoading ? 'Converting...' : 'Convert to Notion'}
                  </button>
                  
                  {message && (
                    <div className="mt-4 p-4 bg-green-100 text-green-700 rounded-md">
                      {message}
                    </div>
                  )}
                  
                  {error && (
                    <div className="mt-4 p-4 bg-red-100 text-red-700 rounded-md">
                      {error}
                    </div>
                  )}

                  {parsedContent && (
                    <div className="mt-8 w-full">
                      <h2 className="text-xl font-semibold mb-4">Parsed PDF Content</h2>
                      <div className="bg-gray-50 p-4 rounded-lg">
                        <p className="mb-2"><strong>Pages:</strong> {parsedContent.metadata.pageCount}</p>
                        <div className="mt-4">
                          <h3 className="font-medium mb-2">Content Preview:</h3>
                          {aiRaw && (
                            <div className="mb-4">
                              <div className="text-xs text-gray-500 mb-1">Gemini Response:</div>
                              <pre className="max-h-60 overflow-y-auto bg-white p-4 rounded border text-sm whitespace-pre-wrap break-words">{aiRaw}</pre>
                            </div>
                          )}
                        </div>
                        <button
                          onClick={handleSendToNotion}
                          className="mt-6 px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
                          disabled={isLoading}
                        >
                          {isLoading ? 'Sending to Notion...' : 'Send to Notion'}
                        </button>
                        {notionStatus && (
                          <div className="mt-4 p-2 rounded text-center"
                            style={{ background: notionStatus.includes('Page created') ? '#d1fae5' : '#fee2e2', color: notionStatus.includes('Page created') ? '#065f46' : '#991b1b' }}>
                            {notionStatus}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
