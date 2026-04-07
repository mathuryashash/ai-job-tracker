@echo off
git init
git add .
git commit -m "Initial commit: Push all files to GitHub repository"
git remote add origin %1
git remote set-url origin %1
git branch -M main
git push -u origin main
