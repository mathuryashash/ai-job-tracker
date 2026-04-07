# AI Resume & Job Tracker

A full-stack web application that helps job seekers optimize their resumes using AI and track their job applications through an intuitive Kanban board interface.

## Features

- 📄 **Resume Upload & AI Analysis**: Upload PDF resumes and get AI-powered scoring with skill gap analysis
- 💌 **Cover Letter Generation**: Generate tailored cover letters for specific job applications
- 📋 **Job Application Tracking**: Drag-and-drop Kanban board to track applications through different stages
- ⏱️ **Activity Timeline**: Chronological view of all activities related to each job application
- 🔐 **Secure Authentication**: Third-party authentication (Auth0/Firebase) with protected user data
- ⚡ **Background Processing**: AI analysis happens asynchronously using BullMQ queue to prevent blocking the UI

## Technology Stack

### Frontend
- React 18 with TypeScript
- Vite for fast development builds
- Tailwind CSS for styling
- Headless UI for accessible components
- @hello-pangea/dnd for drag-and-drop functionality
- Chart.js/Recharts for skills radar visualization
- React Query for server state management
- Axios for HTTP requests

### Backend
- Node.js 18 LTS with TypeScript
- Express.js for API routing
- PostgreSQL database with Prisma ORM
- BullMQ with Redis for background job processing
- Anthropic Claude API for AI capabilities
- Zod for request/response validation
- Winston for logging
- Helmet.js for security headers

### DevOps & Infrastructure
- Docker and Docker Compose for containerization
- GitHub Actions for CI/CD
- AWS/Google Cloud/Azure for deployment (options)
- Supabase (optional) for managed PostgreSQL + Auth

## Documentation

Detailed documentation is available in the `docs/` directory:

- [Product Requirements Document](docs/plans/2026-03-24-ai-resume-job-tracker-prd.md) - Complete PRD with features, user flows, and specifications
- [System Architecture](docs/architecture/system-architecture.md) - Technical architecture overview and component details
- [API Reference](docs/api/api-reference.md) - Complete API endpoint documentation
- [Security Best Practices](docs/security/security-best-practices.md) - Security considerations and implementation

## Getting Started

Please refer to the individual documentation files for setup instructions, development guidelines, and deployment procedures.

## License

This project is proprietary and confidential.