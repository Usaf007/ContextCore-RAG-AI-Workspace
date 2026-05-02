from fastapi import FastAPI, UploadFile, File
from typing import List
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import shutil
import os

# LangChain Imports
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_google_genai import ChatGoogleGenerativeAI, GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import Chroma
from langchain_core.prompts import PromptTemplate
from langchain_community.document_loaders import PyPDFLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from dotenv import load_dotenv

load_dotenv()

app = FastAPI()

# --- CORS Configuration ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- Data Models ---
class QueryRequest(BaseModel):
    query: str
    chat_history: list[dict] = []  # Added memory array

# --- AI & Database Initialization ---
# Using the lightning-fast Flash model
llm = ChatGoogleGenerativeAI(model="gemini-2.5-flash", temperature=0.3)
# The Memory Engine: Swapped to a local, free, open-source model!
embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
vector_db = Chroma(persist_directory="./chroma_db", embedding_function=embeddings)

# --- Prompt Template (With Memory) ---
prompt_template = PromptTemplate(
    input_variables=["chat_history", "context", "question"],
    template="""You are an expert ContextCore document analyst. Answer the user's Question based ONLY on the provided Context. 
    Read the Chat History to understand what the user is referring to (e.g., "he", "it", or previous concepts).
    Format your response beautifully using Markdown (bolding, bullet points) where appropriate.

Chat History:
{chat_history}

Context:
{context}

Question: {question}
Answer:"""
)

@app.post("/ask")
async def ask_question(request: QueryRequest):
    try:
        # 1. Format the conversation history into a readable script
        history_str = "\n".join([f"{msg['role'].capitalize()}: {msg['text']}" for msg in request.chat_history])

        # 2. Search the vector database
        results = vector_db.similarity_search(request.query, k=15)
        context_text = "\n\n".join([doc.page_content for doc in results])
        
        # --Extract exact text chunks for the X-Ray UI ---
        raw_sources = []
        for doc in results:
            raw_sources.append({
                "page": str(doc.metadata.get("page", "Unknown Page")),
                "text": doc.page_content
            })

        # 3. Inject memory and context into the prompt
        final_prompt = prompt_template.format(
            chat_history=history_str,
            context=context_text,
            question=request.query
        )

        # 4. Generate the response
        response = llm.invoke(final_prompt)
        
        # Return both the AI answer AND the raw vector data
        return {"answer": response.content, "sources": raw_sources}
    except Exception as e:
        return {"error": str(e)}

@app.post("/upload")
async def upload_documents(files: List[UploadFile] = File(...)):
    try:
        processed_names = []
        # Loop through every file the user selected
        for file in files:
            # 1. Save file temporarily
            temp_file_path = f"./temp_{file.filename}"
            with open(temp_file_path, "wb") as buffer:
                shutil.copyfileobj(file.file, buffer)

            # 2. Extract and split text
            loader = PyPDFLoader(temp_file_path)
            docs = loader.load()
            text_splitter = RecursiveCharacterTextSplitter(chunk_size=4000, chunk_overlap=800)
            splits = text_splitter.split_documents(docs)

            # 3. Inject into ChromaDB memory
            vector_db.add_documents(splits)

            # 4. Cleanup
            os.remove(temp_file_path)
            processed_names.append(file.filename)

        return {"message": f"Successfully processed {len(processed_names)} documents.", "filenames": processed_names}
    except Exception as e:
        return {"error": str(e)}