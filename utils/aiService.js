const axios = require('axios');

// --- API Configuration ---
// 1. Exa API for web search (Retrieval)
// Get your free API key from https://dashboard.exa.ai/
const EXA_API_KEY = process.env.EXA_API_KEY;
const EXA_API_ENDPOINT = 'https://api.exa.ai/search';

// 2. Generative AI API for analysis (Generation)
// We'll use Groq for fast access to open-source models. Get your free API key at https://console.groq.com/keys
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_API_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Uses a two-step AI process (RAG) to score and correct a student's submission.
 * 1. Retrieves relevant web content using the Exa API.
 * 2. Generates a score and correction using a generative AI via Groq.
 * @param {string} submissionContent The text content of the submission.
 * @returns {Promise<{score: number, correction: string}>} The score and correction from the AI.
 */
const getAIScoreAndCorrection = async (submissionContent) => {
    if (!EXA_API_KEY || !GROQ_API_KEY) {
        console.error('EXA_API_KEY or GROQ_API_KEY is not set. Please add them to your .env file.');
        return {
            score: 0,
            correction: 'AI service is not configured. Please contact an administrator. (API keys missing).'
        };
    }

    try {
        // --- Step 1: Retrieve web content with Exa API ---
        const searchQuery = `In-depth analysis of: ${submissionContent.substring(0, 200)}`;
        const exaResponse = await axios.post(EXA_API_ENDPOINT, {
            query: searchQuery,
            num_results: 3, // Get top 3 results
            text: true, // Include the text content of the pages
        }, {
            headers: {
                'x-api-key': EXA_API_KEY,
                'Content-Type': 'application/json'
            }
        });

        const webContext = exaResponse.data.results.map(result => `Title: ${result.title}\nURL: ${result.url}\nContent: ${result.text}`).join('\n\n---\n\n');

        // --- Step 2: Generate score and correction with Groq ---
        const prompt = `EVALUATE THE FOLLOWING STUDENT SUBMISSION:

STUDENT SUBMISSION:
${submissionContent}

ADDITIONAL CONTEXT (for reference only):
${webContext}

YOUR TASK:
1. Carefully analyze the student's submission for:
   - Accuracy and completeness of information
   - Depth of understanding
   - Clarity and organization
   - Relevance to the topic
   - Use of supporting evidence

2. Provide a detailed evaluation in this JSON format:
{
  "score": <integer 0-100, using the full scoring range based on quality>,
  "correction": "<Detailed feedback including:\n   - Key strengths of the submission\n   - Specific areas for improvement\n   - Suggestions for further learning\n   - References to the provided context when relevant\n   > Be specific, constructive, and encouraging>"
}

IMPORTANT:
- Be strict but fair in your evaluation
- Use the full scoring range (0-100) appropriately
- Provide specific examples from the submission in your feedback
- Focus on both content quality and presentation`;

        const groqResponse = await axios.post(GROQ_API_ENDPOINT, {
            messages: [
                {
                    role: 'system',
                    content: `You are an expert educator with deep knowledge in the subject matter. 
                    Your task is to evaluate student submissions fairly and provide detailed, constructive feedback.
                    
                    SCORING GUIDELINES:
                    - 90-100: Exceptional work that demonstrates deep understanding and insight
                    - 80-89: Strong work with minor areas for improvement
                    - 70-79: Satisfactory but with several areas needing improvement
                    - 60-69: Basic understanding shown but significant gaps in knowledge
                    - Below 60: Incomplete or significantly flawed understanding
                    
                    Always respond with valid JSON only, no markdown formatting.`
                },
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            // Using llama3-70b-8192 as the recommended replacement for the decommissioned model
            model: 'llama3-70b-8192',
            temperature: 0.7, // Increased for more varied responses
            top_p: 0.9,
            max_tokens: 1000,
            response_format: { type: 'json_object' },
        }, {
            headers: {
                'Authorization': `Bearer ${GROQ_API_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const generatedText = groqResponse.data.choices[0].message.content;
        const result = JSON.parse(generatedText);

        return { score: result.score, correction: result.correction };

    } catch (error) {
        console.error('Error calling AI service:', error.response ? error.response.data : error.message);
        return {
            score: 0,
            correction: 'There was an error processing the submission with the AI service. Please try again later.'
        };
    }
};

module.exports = { getAIScoreAndCorrection };
