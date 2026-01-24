import os
import textwrap
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai
from google.genai.errors import APIError
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# --- Configuration ---
GEMINI_MODEL = "gemini-2.5-flash-preview-09-2025"

app = FastAPI(
    title="Gemini Local Coder Backend",
    description="FastAPI service to handle context and call the Gemini API."
)

# --- CORS Setup ---
# Crucial for allowing the VS Code Webview (which runs on a special origin)
# or a development origin (like localhost:3000) to communicate.
origins = [
    "http://127.0.0.1:8000",
    "vscode-webview://*", # Allows the VS Code webview origin
    "*" # Wildcard for simplicity in development; tighten in production if needed
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Pydantic Schemas ---
class ChatRequest(BaseModel):
    prompt: str
    selectedCode: str
    language: str

class ChatResponse(BaseModel):
    responseText: str

# --- Gemini Client Initialization ---
try:
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY environment variable not set.")
    
    client = genai.Client(api_key=gemini_api_key)
    print("Gemini Client initialized successfully.")

except ValueError as e:
    print(f"Initialization Error: {e}")
    client = None
except Exception as e:
    print(f"An unexpected error occurred during client initialization: {e}")
    client = None


# --- Prompt Engineering Function ---
def create_coding_prompt(data: ChatRequest) -> str:
    """Constructs a detailed prompt based on user input and context."""
    
    # 1. System Instruction (defines the AI's role and tone)
    system_instruction = textwrap.dedent(f"""
        You are an expert Senior Software Engineer specializing in {data.language}.
        Your goal is to assist the user with code generation, explanation, debugging, and refactoring.
        
        If the request is for code replacement or insertion:
        - Provide only the clean, complete code block within markdown.
        - DO NOT add extra commentary, warnings, or preamble text outside the code block.
        
        If the request is for explanation or general advice:
        - Provide a clear, concise explanation.
        
        Context provided below:
    """)

    # 2. User Context and Task
    user_context = textwrap.dedent(f"""
        Programming Language: {data.language}
        
        --- Selected Code Context ---
        {data.selectedCode if data.selectedCode else 'No code selected.'}
        --- End Selected Code Context ---
        
        User's Request: {data.prompt}
    """)
    
    return system_instruction + user_context


# --- FastAPI Endpoints ---
@app.get("/")
def health_check():
    """Simple health check endpoint."""
    if not client:
         return {"status": "error", "message": "Gemini Client not initialized. Check GEMINI_API_KEY."}
    return {"status": "ok", "message": "Gemini Local Coder Backend is running."}

@app.post("/chat", response_model=ChatResponse)
async def chat_handler(request: ChatRequest):
    """Handles the chat request, calls Gemini, and returns the response."""
    
    if not client:
        raise HTTPException(
            status_code=503,
            detail="Gemini API Key missing or client initialization failed."
        )

    try:
        # Create the comprehensive prompt
        full_prompt = create_coding_prompt(request)

        # Call the Gemini API
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=full_prompt,
        )
        
        return ChatResponse(responseText=response.text)

    except APIError as e:
        print(f"Gemini API Error: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Gemini API Error: {str(e)}"
        )
    except Exception as e:
        print(f"Internal Server Error: {e}")
        raise HTTPException(
            status_code=500,
            detail="An unexpected error occurred on the backend."
        )

# Example usage (run with: uvicorn main:app --reload)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)