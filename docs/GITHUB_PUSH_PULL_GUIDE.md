# GitHub Push & Pull Guide

This guide covers the essential Git commands for pushing and pulling changes when working with the Stock Verify repository.

## Prerequisites

Before you begin, ensure you have:
- Git installed on your machine
- A GitHub account with access to this repository
- SSH keys or Personal Access Token configured for authentication

## Basic Workflow

### 1. Pulling Changes

Always pull the latest changes before starting work to avoid merge conflicts.

```bash
# Switch to the main branch
git checkout main

# Pull the latest changes from GitHub
git pull origin main
```

### 2. Creating a Feature Branch

Create a new branch for your work:

```bash
# Create and switch to a new branch
git checkout -b feature/your-feature-name
```

### 3. Making Changes

After making your code changes:

```bash
# Check the status of your changes
git status

# View the differences
git diff
```

### 4. Staging and Committing

```bash
# Stage specific files
git add path/to/file

# Or stage all changes
git add .

# Commit with a descriptive message
git commit -m "feat: add new feature description"
```

### 5. Pushing Changes

Push your branch to GitHub:

```bash
# First push of a new branch
git push -u origin feature/your-feature-name

# Subsequent pushes
git push
```

## Common Scenarios

### Updating Your Branch with Main

Keep your branch up to date with the latest changes from main:

```bash
# Switch to main and pull latest changes
git checkout main
git pull origin main

# Switch back to your branch
git checkout feature/your-feature-name

# Merge main into your branch
git merge main

# Or rebase onto main (creates cleaner history)
git rebase main
```

### Resolving Merge Conflicts

If you encounter merge conflicts:

1. Open the conflicting files and look for conflict markers:
   ```
   <<<<<<< HEAD
   your changes
   =======
   incoming changes
   >>>>>>> main
   ```

2. Edit the file to resolve conflicts, removing the markers

3. Stage the resolved files:
   ```bash
   git add path/to/resolved/file
   ```

4. Complete the merge or rebase:
   ```bash
   # If merging
   git commit -m "Merge main into feature branch"
   
   # If rebasing
   git rebase --continue
   ```

### Discarding Local Changes

To discard uncommitted changes:

```bash
# Discard changes to a specific file
git checkout -- path/to/file

# Discard all uncommitted changes
git checkout -- .

# Or using git restore (newer syntax)
git restore path/to/file
git restore .
```

## Best Practices

1. **Pull frequently** - Regularly pull changes from main to minimize conflicts
2. **Commit often** - Make small, focused commits with clear messages
3. **Write clear commit messages** - Follow conventional commits format (feat:, fix:, docs:, etc.)
4. **Review before pushing** - Check your changes with `git diff` and `git status`
5. **Use branches** - Never commit directly to main; use feature branches
6. **Keep commits atomic** - Each commit should represent one logical change

## Commit Message Format

Follow the conventional commits format:

```
type(scope): description

[optional body]
```

Types:
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `style:` - Code formatting (no functional changes)
- `refactor:` - Code refactoring
- `test:` - Adding or modifying tests
- `chore:` - Maintenance tasks

Examples:
```bash
git commit -m "feat(auth): add JWT refresh token support"
git commit -m "fix(api): handle null values in response"
git commit -m "docs: update README with setup instructions"
```

## Quick Reference

| Command | Description |
|---------|-------------|
| `git pull origin main` | Pull latest changes from main branch |
| `git push origin branch-name` | Push branch to GitHub |
| `git status` | Check status of working directory |
| `git diff` | View unstaged changes |
| `git log --oneline -10` | View last 10 commits |
| `git branch -a` | List all branches |
| `git checkout branch-name` | Switch to a branch |
| `git stash` | Temporarily save uncommitted changes |
| `git stash pop` | Restore stashed changes |

## Troubleshooting

### Authentication Failed

If you get authentication errors:

1. Ensure you're using a Personal Access Token (not password) for HTTPS
2. Or configure SSH keys for SSH authentication

```bash
# Check your remote URL
git remote -v

# Switch to SSH (if configured)
git remote set-url origin git@github.com:mknoufi/Stock_counting.git

# Or update HTTPS with token
git remote set-url origin https://YOUR_TOKEN@github.com/mknoufi/Stock_counting.git
```

### Rejected Push

If your push is rejected because the remote has changes:

```bash
# Pull and rebase
git pull --rebase origin main

# Then push again
git push origin your-branch
```

### Accidental Commit to Main

If you accidentally committed to main:

```bash
# Create a new branch with your changes
git branch feature/my-changes

# Reset main to match remote
git reset --hard origin/main

# Switch to your new branch
git checkout feature/my-changes
```

## Related Documentation

- [GitHub Upload Instructions](/GITHUB_UPLOAD_INSTRUCTIONS.md) - Initial repository setup
- [Developer Report](/DEVELOPER_REPORT.md) - Development guidelines
- [Verified Coding Policy](verified_coding_policy.md) - Coding standards
