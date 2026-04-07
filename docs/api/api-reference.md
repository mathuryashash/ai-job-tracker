# AI Resume & Job Tracker - API Reference

## Base URL
```
https://api.resumejobtracker.com/v1
```

## Authentication
All endpoints require authentication unless otherwise noted.

### Auth0/Firebase Integration
- Uses Authorization Code Flow with PKCE for SPA security
- Access tokens are Bearer tokens in the Authorization header
- Token format: `Authorization: Bearer <access_token>`

### Anonymous Usage Limits
- Unauthenticated users limited to 3 resume analyses
- After limit, prompted to authenticate for continued use

## Error Responses
All errors follow this format:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error message",
    "details": {} // Optional additional details
  }
}
```

Common HTTP Status Codes:
- 200: Success
- 201: Created
- 400: Bad Request (validation error)
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 422: Unprocessable Entity (semantic errors)
- 429: Too Many Requests (rate limiting)
- 500: Internal Server Error
- 503: Service Unavailable

## Rate Limiting
- Auth endpoints: 10 requests/minute per IP
- General API: 100 requests/minute per user
- AI processing: 10 requests/minute per user
- Exceeded limits return 429 with Retry-After header

## Endpoints

### Authentication

#### Initiate Login
```
GET /auth/login
```
Initiates the Auth0/Firebase login flow. Redirects to provider.

**Response:** Redirect to authentication provider

#### Handle Callback
```
GET /auth/callback
```
Handles the redirect from authentication provider.

**Query Parameters:**
- `code`: Authorization code from provider
- `state`: State parameter for CSRF protection

**Response:** 
- Sets HTTP-only cookie with session token
- Redirects to frontend application

#### Logout
```
POST /auth/logout
```
Logs out the current user.

**Headers:**
- Authorization: Bearer <access_token>

**Response:**
```json
{
  "success": true
}
```

#### Get Current User
```
GET /auth/me
```
Gets the current user's profile information.

**Headers:**
- Authorization: Bearer <access_token>

**Response:**
```json
{
  "id": "auth0|1234567890",
  "email": "user@example.com",
  "name": "John Doe",
  "picture": "https://example.com/picture.jpg",
  "createdAt": "2026-03-01T10:00:00Z",
  "updatedAt": "2026-03-01T10:00:00Z",
  "preferences": {
    "theme": "light",
    "notifications": true
  }
}
```

### Resume Management

#### Upload Resume
```
POST /resumes/upload
```
Uploads a PDF resume and queues it for analysis.

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: multipart/form-data

**Form Data:**
- `file`: PDF resume file (max 5MB)
- `jobDescription`: Optional job description text for analysis
- `applicationId`: Optional ID of existing job application to link to

**Response:**
```json
{
  "id": "resume_123",
  "userId": "auth0|1234567890",
  "filename": "resume_20260324.pdf",
  "originalName": "Yashash_Resume.pdf",
  "size": 245760,
  "uploadedAt": "2026-03-24T10:30:00Z",
  "status": "processing",
  "analysisJobId": "job_abc123"
}
```

#### Get Resume
```
GET /resumes/:id
```
Gets resume metadata.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Resume ID

**Response:**
```json
{
  "id": "resume_123",
  "userId": "auth0|1234567890",
  "filename": "resume_20260324.pdf",
  "originalName": "Yashash_Resume.pdf",
  "size": 245760,
  "uploadedAt": "2026-03-24T10:30:00Z",
  "status": "completed"
}
```

#### Get Resume Analysis
```
GET /resumes/:id/analysis
```
Gets the AI analysis results for a resume.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Resume ID

**Query Parameters:**
- `applicationId`: Optional filter to get analysis for specific application

**Response:**
```json
{
  "id": "analysis_456",
  "resumeId": "resume_123",
  "matchPercentage": 78,
  "skillsRadar": {
    "Programming": 85,
    "Communication": 60,
    "Leadership": 45,
    "Problem Solving": 90,
    "Teamwork": 70
  },
  "missingKeywords": [
    "AWS",
    "Docker",
    "Kubernetes",
    "Agile Methodologies"
  ],
  "suggestions": [
    "Add specific AWS services you've used (EC2, S3, Lambda)",
    "Mention any experience with containerization technologies",
    "Highlight leadership roles in group projects",
    "Include quantifiable achievements where possible"
  ],
  "createdAt": "2026-03-24T10:32:00Z",
  "claudePrompt": "[REDACTED FOR BREVITY]",
  "claudeResponseId": "resp_xyz789"
}
```

#### Regenerate Analysis
```
POST /resumes/:id/analysis/regenerate
```
Regenerates AI analysis for a resume (e.g., after edits).

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Path Parameters:**
- `id`: Resume ID

**Request Body:**
```json
{
  "jobDescription": "Updated job description text..."
}
```

**Response:**
```json
{
  "success": true,
  "analysisJobId": "job_def456",
  "message": "Analysis queued for processing"
}
```

### Job Applications

#### List Applications
```
GET /applications
```
Lists all job applications for the current user.

**Headers:**
- Authorization: Bearer <access_token>

**Query Parameters:**
- `status`: Filter by status (todo, applied, interviewing, offer, rejected)
- `limit`: Number of results to return (default: 20, max: 100)
- `offset`: Offset for pagination
- `sort`: Sort field (createdAt, updatedAt, companyName)
- `order`: Sort order (asc, desc)

**Response:**
```json
{
  "applications": [
    {
      "id": "app_789",
      "userId": "auth0|1234567890",
      "companyName": "Tech Corp",
      "positionTitle": "Software Engineer Intern",
      "jobDescription": "We are looking for...",
      "jobUrl": "https://techcorp.com/careers/intern",
      "applicationDate": "2026-03-20",
      "status": "applied",
      "resumeId": "resume_123",
      "coverLetterId": "letter_101",
      "createdAt": "2026-03-20T14:30:00Z",
      "updatedAt": "2026-03-24T09:15:00Z"
    }
  ],
  "pagination": {
    "limit": 20,
    "offset": 0,
    "total": 1,
    "hasMore": false
  }
}
```

#### Create Application
```
POST /applications
```
Creates a new job application.

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request Body:**
```json
{
  "companyName": "Tech Corp",
  "positionTitle": "Software Engineer Intern",
  "jobDescription": "We are looking for...",
  "jobUrl": "https://techcorp.com/careers/intern",
  "applicationDate": "2026-03-20"
}
```

**Response:**
```json
{
  "id": "app_789",
  "userId": "auth0|1234567890",
  "companyName": "Tech Corp",
  "positionTitle": "Software Engineer Intern",
  "jobDescription": "We are looking for...",
  "jobUrl": "https://techcorp.com/careers/intern",
  "applicationDate": "2026-03-20",
  "status": "todo",
  "createdAt": "2026-03-20T14:30:00Z",
  "updatedAt": "2026-03-20T14:30:00Z"
}
```

#### Get Application
```
GET /applications/:id
```
Gets a specific job application.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Application ID

**Response:**
```json
{
  "id": "app_789",
  "userId": "auth0|1234567890",
  "companyName": "Tech Corp",
  "positionTitle": "Software Engineer Intern",
  "jobDescription": "We are looking for...",
  "jobUrl": "https://techcorp.com/careers/intern",
  "applicationDate": "2026-03-20",
  "status": "applied",
  "resumeId": "resume_123",
  "coverLetterId": "letter_101",
  "createdAt": "2026-03-20T14:30:00Z",
  "updatedAt": "2026-03-24T09:15:00Z"
}
```

#### Update Application
```
PUT /applications/:id
```
Updates a job application.

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Path Parameters:**
- `id`: Application ID

**Request Body:**
```json
{
  "companyName": "Updated Tech Corp",
  "positionTitle": "Senior Software Engineer",
  "status": "interviewing"
}
```

**Response:**
```json
{
  "id": "app_789",
  "userId": "auth0|1234567890",
  "companyName": "Updated Tech Corp",
  "positionTitle": "Senior Software Engineer",
  "jobDescription": "We are looking for...",
  "jobUrl": "https://techcorp.com/careers/intern",
  "applicationDate": "2026-03-20",
  "status": "interviewing",
  "createdAt": "2026-03-20T14:30:00Z",
  "updatedAt": "2026-03-24T09:15:00Z"
}
```

#### Delete Application
```
DELETE /applications/:id
```
Deletes a job application.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Application ID

**Response:**
```json
{
  "success": true
}
```

#### Move Application
```
POST /applications/:id/move
```
Moves an application to a different status column.

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Path Parameters:**
- `id`: Application ID

**Request Body:**
```json
{
  "status": "interviewing"
}
```

**Response:**
```json
{
  "id": "app_789",
  "userId": "auth0|1234567890",
  "companyName": "Tech Corp",
  "positionTitle": "Software Engineer Intern",
  "jobDescription": "We are looking for...",
  "jobUrl": "https://techcorp.com/careers/intern",
  "applicationDate": "2026-03-20",
  "status": "interviewing",
  "resumeId": "resume_123",
  "coverLetterId": "letter_101",
  "createdAt": "2026-03-20T14:30:00Z",
  "updatedAt": "2026-03-24T09:15:00Z"
}
```

### Cover Letters

#### Generate Cover Letter
```
POST /cover-letters/generate
```
Generates a cover letter for a job application.

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Request Body:**
```json
{
  "applicationId": "app_789",
  "resumeId": "resume_123",
  "jobDescription": "We are looking for...",
  "tone": "professional" // or "enthusiastic", "formal"
}
```

**Response:**
```json
{
  "id": "letter_101",
  "applicationId": "app_789",
  "content": "Dear Hiring Manager,\n\nI am writing to express my interest in the Software Engineer Intern position at Tech Corp...",
  "createdAt": "2026-03-24T10:35:00Z",
  "updatedAt": "2026-03-24T10:35:00Z"
}
```

#### Get Cover Letter
```
GET /cover-letters/:id
```
Gets a specific cover letter.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Cover letter ID

**Response:**
```json
{
  "id": "letter_101",
  "applicationId": "app_789",
  "content": "Dear Hiring Manager,\n\nI am writing to express my interest in the Software Engineer Intern position at Tech Corp...",
  "createdAt": "2026-03-24T10:35:00Z",
  "updatedAt": "2026-03-24T10:35:00Z"
}
```

#### Update Cover Letter
```
PUT /cover-letters/:id
```
Updates a cover letter (typically user edits).

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Path Parameters:**
- `id`: Cover letter ID

**Request Body:**
```json
{
  "content": "Updated cover letter content..."
}
```

**Response:**
```json
{
  "id": "letter_101",
  "applicationId": "app_789",
  "content": "Updated cover letter content...",
  "createdAt": "2026-03-24T10:35:00Z",
  "updatedAt": "2026-03-24T11:20:00Z"
}
```

### Activity Timeline

#### Get Application Activities
```
GET /applications/:id/activities
```
Gets the activity timeline for a job application.

**Headers:**
- Authorization: Bearer <access_token>

**Path Parameters:**
- `id`: Application ID

**Query Parameters:**
- `limit`: Number of results to return (default: 50)
- `offset`: Offset for pagination
- `type`: Filter by activity type
- `fromDate`: ISO date string for start of range
- `toDate`: ISO date string for end of range

**Response:**
```json
{
  "activities": [
    {
      "id": "act_001",
      "applicationId": "app_789",
      "type": "resume-upload",
      "description": "Resume uploaded and analysis queued",
      "metadata": {
        "resumeId": "resume_123",
        "fileName": "Yashash_Resume.pdf"
      },
      "createdAt": "2026-03-24T10:30:00Z",
      "updatedAt": "2026-03-24T10:30:00Z"
    },
    {
      "id": "act_002",
      "applicationId": "app_789",
      "type": "status-change",
      "description": "Application status changed from todo to applied",
      "metadata": {
        "oldStatus": "todo",
        "newStatus": "applied"
      },
      "createdAt": "2026-03-24T09:15:00Z",
      "updatedAt": "2026-03-24T09:15:00Z"
    }
  ],
  "pagination": {
    "limit": 50,
    "offset": 0,
    "total": 2,
    "hasMore": false
  }
}
```

#### Add Manual Activity
```
POST /applications/:id/activities
```
Adds a manual activity to the timeline (note, call, email, etc.).

**Headers:**
- Authorization: Bearer <access_token>
- Content-Type: application/json

**Path Parameters:**
- `id`: Application ID

**Request Body:**
```json
{
  "type": "note",
  "description": "Spoke with recruiter about next steps",
  "metadata": {
    "contact": "Jane Smith",
    "contactTitle": "Technical Recruiter"
  }
}
```

**Response:**
```json
{
  "id": "act_003",
  "applicationId": "app_789",
  "type": "note",
  "description": "Spoke with recruiter about next steps",
  "metadata": {
    "contact": "Jane Smith",
    "contactTitle": "Technical Recruiter"
  },
  "createdAt": "2026-03-24T11:00:00Z",
  "updatedAt": "2026-03-24T11:00:00Z"
}
```

## WebSocket Events (Real-time Updates)

The application uses WebSocket connections for real-time updates when background jobs complete.

### Connection
```
ws://api.resumejobtracker.com/ws
```

### Authentication
Upon connection, send:
```json
{
  "token": "<jwt_access_token>"
}
```

### Events

#### Analysis Complete
Sent when resume analysis finishes:
```json
{
  "event": "analysis_complete",
  "data": {
    "resumeId": "resume_123",
    "applicationId": "app_789",
    "analysisId": "analysis_456"
  }
}
```

#### Cover Letter Generated
Sent when cover letter generation finishes:
```json
{
  "event": "cover_letter_complete",
  "data": {
    "coverLetterId": "letter_101",
    "applicationId": "app_789"
  }
}
```

#### Application Updated
Sent when application data changes:
```json
{
  "event": "application_updated",
  "data": {
    "applicationId": "app_789",
    "changes": {
      "status": "interviewing"
    }
  }
}
```

## Appendix: Activity Types

| Type | Description | Metadata Fields |
|------|-------------|-----------------|
| resume-upload | Resume file uploaded | resumeId, fileName |
| cover-letter-gen | Cover letter generated | coverLetterId |
| status-change | Application status changed | oldStatus, newStatus |
| note | Manual note added | contact, contactTitle |
| interview | Interview scheduled/interviewed | interviewer, interviewType, outcome |
| email | Email sent/received | to, from, subject |
| call | Phone call made/received | contact, purpose, outcome |
| document-upload | Supporting document uploaded | documentType, fileName |
| offer-received | Job offer received | offerDetails, salary, benefits |
| offer-accepted | Job offer accepted | acceptanceDate |
| offer-rejected | Job offer rejected | reason |

## Appendix: Application Statuses

| Status | Description |
|--------|-------------|
| todo | Application identified but not yet submitted |
| applied | Application submitted, awaiting response |
| interviewing | In interview process (phone screen, technical, etc.) |
| offer | Job offer received and under consideration |
| rejected | Application rejected by employer |

## Appendix: Error Codes

| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Request validation failed |
| UNAUTHORIZED | 401 | Missing or invalid authentication |
| FORBIDDEN | 403 | Authenticated but lacks permission |
| NOT_FOUND | 404 | Resource not found |
| CONFLICT | 409 | Resource conflict (e.g., duplicate) |
| UNPROCESSABLE_ENTITY | 422 | Semantic errors in valid request |
| RATE_LIMITED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Unexpected server error |
| SERVICE_UNAVAILABLE | 503 | Temporary service degradation |
| TIMEOUT_ERROR | 504 | Upstream service timeout |

## Changelog

### Version 1.0.0 (March 24, 2026)
- Initial API release
- All MVP endpoints implemented
- Authentication with Auth0/Firebase
- Resume analysis and job tracking features
- Cover letter generation
- Activity timeline
- WebSocket real-time updates

---
*This API documentation is subject to change. Versioning will be implemented as the API evolves.*