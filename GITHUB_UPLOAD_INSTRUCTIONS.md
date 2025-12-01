# How to Upload "Stock_counting" to GitHub

Since the GitHub CLI (`gh`) is not installed, you will need to create the repository on GitHub's website and then push your code.

## Step 1: Create the Repository on GitHub

1. Log in to [GitHub.com](https://github.com).
2. Click the **+** icon in the top-right corner and select **New repository**.
3. **Repository name**: `Stock_counting`
4. **Public/Private**: Select **Public**.
5. **Initialize this repository with**: Leave all unchecked (no README, no .gitignore, no License) — we already have these locally.
6. Click **Create repository**.

## Step 2: Push Your Code

Open your terminal in the project folder (`STOCK_VERIFY_2-db-maped`) and run the following commands:

```bash
# 1. Initialize Git (if not already done)
git init

# 2. Add all files (respecting .gitignore)
git add .

# 3. Commit the files
git commit -m "Initial commit: Stock Counting App"

# 4. Rename the default branch to main
git branch -M main

# 5. Add the remote repository (Replace YOUR_USERNAME with your actual GitHub username)
git remote add origin https://github.com/YOUR_USERNAME/Stock_counting.git

# 6. Push to GitHub
git push -u origin main
```

## Troubleshooting

* **"remote origin already exists"**: Run `git remote remove origin` and try step 5 again.
* **Authentication**: You may be asked for your GitHub username and password. If you have 2FA enabled, you must use a **Personal Access Token** instead of your password.
