# Windows Transfer & Setup Guide

This guide details how to transfer the **Stock Verify** application from macOS to Windows and set it up for development or production.

## 1. Prerequisites on Windows

Before transferring the code, ensure the following are installed on your Windows machine:

1. **Git**: [Download Git for Windows](https://git-scm.com/download/win)
2. **Node.js (LTS)**: [Download Node.js](https://nodejs.org/) (Version 20+ recommended)
3. **Python**: [Download Python](https://www.python.org/downloads/) (Version 3.10 or 3.11 recommended)
    * *Important*: Check "Add Python to PATH" during installation.
4. **MongoDB** (Optional, if running local DB): [Download MongoDB Community Server](https://www.mongodb.com/try/download/community)
    * Alternatively, you can use a cloud MongoDB (Atlas) and update your `.env` file.

## 2. Transferring the Code

### Option A: Using Git (Recommended)

1. **On macOS**: Ensure all changes are committed and pushed to your repository.

    ```bash
    git add .
    git commit -m "Prepare for Windows transfer"
    git push origin main
    ```

2. **On Windows**: Open PowerShell or Command Prompt and clone the repository.

    ```powershell
    git clone <your-repo-url>
    cd STOCK_VERIFY_2-db-maped
    ```

### Option B: Using a Zip File

1. **On macOS**: Compress the project folder, **excluding** large dependency folders to save space and avoid OS conflicts.
    * Exclude: `node_modules`, `.venv`, `.git`, `__pycache__`.
2. **Transfer**: Copy the zip file to your Windows machine (USB, Cloud, Network).
3. **On Windows**: Extract the zip file to a folder (e.g., `C:\Projects\StockVerify`).

## 3. Setup on Windows

The project includes a PowerShell setup script to automate dependency installation.

1. Open **PowerShell** as Administrator (Right-click Start > Terminal (Admin) or PowerShell (Admin)).
2. Navigate to the project directory.

    ```powershell
    cd C:\path\to\STOCK_VERIFY_2-db-maped
    ```

3. **Allow Scripts**: You may need to allow script execution if you haven't before.

    ```powershell
    Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
    ```

4. **Run Setup**:

    ```powershell
    .\setup.ps1
    ```

    * This script will:
        * Create a Python virtual environment (`.venv`).
        * Install backend dependencies from `backend/requirements.txt`.
        * Install frontend dependencies (`npm install`).

## 4. Configuration

1. **Environment Variables**:
    * Copy `.env.example` (if available) or create a `.env` file in the `backend` directory.
    * Ensure your `MONGODB_URL` is correct (e.g., `mongodb://localhost:27017` for local Windows MongoDB).

## 5. Running the App

You can use the provided helper script to start everything.

1. **Start All Services**:

    ```powershell
    .\start_services.ps1
    ```

    * This will attempt to start MongoDB, the Backend (Uvicorn), and the Frontend.

### Manual Startup (If scripts fail)

**Backend**:

```powershell
# Activate venv
.\.venv\Scripts\Activate.ps1

# Run Server
python -m uvicorn backend.server:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend**:

```powershell
cd frontend
npm run web
# OR for Android/iOS
npm run android
npm run ios
```

## 6. Troubleshooting

* **"Script is not digitally signed"**: Run `Set-ExecutionPolicy RemoteSigned -Scope CurrentUser`.
* **"Python not found"**: Ensure Python is in your system PATH (check by running `python --version`).
* **"npm not found"**: Ensure Node.js is installed and in PATH.
* **MongoDB Connection Error**: Ensure the MongoDB service is running (`net start MongoDB` in Admin PowerShell) or use MongoDB Compass to verify connection.
