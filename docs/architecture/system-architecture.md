# AI Resume & Job Tracker - System Architecture

## Overview
This document describes the system architecture for the AI Resume & Job Tracker application, detailing the components, their interactions, and the technologies used.

## High-Level Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│   User Device   │    │   CDN / Edge     │    │  Third Party       │
│ (Browser/App)   │◄──►│   (Static Assets)│◄──►│ Services           │
└─────────────────┘    └──────────────────┘    │ (Auth0, Claude)    │
        │                                      └────────────────────┘
        │ HTTPS/WSS                                 ▲
        ▼                                           │
┌─────────────────┐                     ┌──────────────────┐
│   API Gateway   │                     │   External       │
│ (Node/Express)  │                     │   Services       │
└─────────────────┘                     └──────────────────┘
        │                                      ▲
        ▼                                      │
┌─────────────────┐                    ┌──────────────────┐
│  Auth Service   │◄──────────────────►│  Auth0/Firebase  │
└─────────────────┘                    └──────────────────┘
        │
        ▼
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│ Application     │    │   Resume         │    │  Background        │
│ Logic Layer     │    │   Processing     │    │  Job Workers       │
└─────────────────┘    └──────────────────┘    └────────────────────┘
        │                     │                         │
        ▼                     ▼                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│   Job Service   │    │   AI Service     │    │   BullMQ Queue     │
└─────────────────┘    └──────────────────┘    └────────────────────┘
        │                     │                         │
        ▼                     ▼                         ▼
┌─────────────────┐    ┌──────────────────┐    ┌────────────────────┐
│ Activity Service│    │   Claude API     │    │     Redis          │
└─────────────────┘    └──────────────────┘    └────────────────────┘
        │                     │                         │
        └─────────┬───────────┘                         │
                  ▼                                     ▼
          ┌─────────────────┐                   ┌──────────────────┐
          │  PostgreSQL     │◄──────────────────►│      Workers     │
          │   (Primary)     │                    │                  │
          └─────────────────┘                    └──────────────────┘
                     │
                     ▼
            ┌──────────────────┐
            │  PostgreSQL      │
            │   (Replicas)     │
            └──────────────────┘
```

## Component Details

### 1. Client Layer
- **Technology:** React 18, TypeScript, Vite
- **Responsibilities:**
  - User interface rendering and interactions
  - State management (React Query + Context API)
  - API communication with backend
  - Offline capabilities (planned for future)
  - Responsive design for mobile/desktop
- **Security:** 
  - CSP headers
  - XSS protection through proper escaping
  - Secure storage of tokens (HttpOnly cookies or secure localStorage usage)

### 2. API Gateway
- **Technology:** Node.js 18, Express.js, TypeScript
- **Responsibilities:**
  - Request routing and middleware chaining
  - Authentication and authorization
  - Rate limiting and DDOS protection
  - Request/response logging
  - Error handling and formatting
  - Input validation and sanitization
- **Security:**
  - Helmet.js for HTTP headers
  - CORS configuration
  - Request size limits
  - IP-based rate limiting

### 3. Authentication Service
- **Technology:** Auth0 or Firebase Authentication
- **Responsibilities:**
  - User registration and login
  - Token generation and validation
  - Social login providers (Google, GitHub)
  - Password reset and account recovery
  - Session management
  - Multi-factor authentication (planned)
- **Security:** 
  - Industry-standard OAuth 2.0 / OpenID Connect
  - PKCE for SPA security
  - Brute force protection
  - Anomalous login detection

### 4. Application Logic Layer
- **Technology:** Node.js, Express, TypeScript
- **Responsibilities:**
  - Business logic coordination
  - Transaction management
  - Workflow orchestration
  - Data validation and transformation
  - Integration between services
- **Patterns:**
  - Service layer pattern
  - Dependency injection
  - Event-driven architecture for loose coupling

### 5. Resume Processing Service
- **Technology:** Node.js, pdf-parse/mammoth.js, TypeScript
- **Responsibilities:**
  - PDF file upload handling
  - Text extraction from PDF resumes
  - Basic formatting preservation
  - File validation (type, size, malware scanning planned)
  - Temporary file management
- **Security:**
  - File type validation
  - File size limits
  - Sandboxed processing environment
  - Automatic cleanup of temporary files
  - Malware scanning integration (planned)

### 6. AI Service
- **Technology:** Node.js, Anthropic Claude API, TypeScript
- **Responsibilities:**
  - Prompt engineering and management
  - Communication with Claude API
  - Response parsing and validation
  - Error handling and retry logic
  - Usage tracking and cost monitoring
  - Caching of frequent requests
- **Security:**
  - API key protection (environment variables)
  - Prompt injection prevention
  - Input sanitization
  - Response validation
  - Rate limiting per user
  - Audit logging of AI interactions

### 7. Job Service
- **Technology:** Node.js, PostgreSQL, Prisma ORM, TypeScript
- **Responsibilities:**
  - Job application CRUD operations
  - Status management (To Do, Applied, Interviewing, etc.)
  - Resume version linking
  - Cover letter association
  - Search and filtering capabilities
- **Security:**
  - Parameterized queries (ORM)
  - Access control checks
  - Data validation
  - Soft deletes for recovery

### 8. Activity Service
- **Technology:** Node.js, PostgreSQL, Prisma ORM, TypeScript
- **Responsibilities:**
  - Timeline event logging
  - Automatic activity generation (resume uploads, etc.)
  - Manual activity creation (notes, calls, etc.)
  - Activity retrieval and filtering
  - Edit/delete functionality for manual entries
- **Security:**
  - User ownership validation
  - Input sanitization
  - Audit trail preservation

### 9. Background Job Workers
- **Technology:** Node.js, BullMQ, Redis, TypeScript
- **Responsibilities:**
  - Asynchronous processing of AI tasks
  - Queue management and prioritization
  - Retry logic with exponential backoff
  - Dead letter queue for failed jobs
  - Progress reporting and monitoring
  - Resource management and scaling
- **Security:**
  - Queue access restricted to authorized workers
  - Job data encryption for sensitive information
  - Worker authentication to queue
  - Poison message handling

### 10. Data Storage Layer
- **Technology:** PostgreSQL (Primary + Read Replicas), Redis
- **Responsibilities:**
  - Persistent storage of user data
  - Application and activity records
  - Caching layer for performance
  - Job queue backend
  - Session storage (optional)
- **Security:**
  - Encryption at rest
  - Connection encryption (TLS)
  - Principle of least privilege database users
  - Regular backups with encryption
  - Network isolation (VPC, security groups)
  - Input validation at storage layer

## Data Flow Examples

### 1. Resume Upload and Analysis Flow
1. User uploads PDF through frontend
2. Frontend validates file type/size, sends to `/api/resumes/upload`
3. API Gateway authenticates request
4. Resume Processing Service:
   - Validates PDF file
   - Extracts text using pdf-parse
   - Stores file temporarily
   - Creates analysis job in BullMQ queue
5. BullMQ Worker:
   - Picks up analysis job
   - Calls AI Service with resume text + job description
   - AI Service:
     - Constructs prompt with safety measures
     - Calls Claude API
     - Processes and validates response
     - Returns structured analysis
   - Worker stores results in PostgreSQL
   - Updates application state
6. Frontend notified via React Query refetch or WebSocket
7. User sees analysis results in UI

### 2. Job Application Creation Flow
1. User fills job application form in frontend
2. Frontend sends to `/api/applications`
3. API Gateway authenticates and validates
4. Job Service:
   - Creates application record
   - Sets initial status to "To Do"
   - Links to user account
   - Returns created application
5. Frontend updates Kanban board optimistically
6. Background sync confirms persistence

### 3. Cover Letter Generation Flow
1. User requests cover letter for application
2. Frontend sends to `/api/cover-letters/generate` with application ID
3. API Gateway authenticates and validates
4. AI Service:
   - Retrieves resume and job description
   - Constructs cover letter prompt
   - Calls Claude API
   - Validates and formats response
5. AI Service returns cover letter
6. Frontend saves cover letter to application
7. Activity Service logs "cover-letter-gen" event

## Infrastructure Considerations

### Deployment Environments
- **Development:** Local Docker Compose with seeded data
- **Staging:** Production-like environment with sanitized data
- **Production:** High-availability setup with monitoring

### Scaling Strategy
- **Horizontal Scaling:**
  - API Gateway: Multiple instances behind load balancer
  - Job Workers: Auto-scaling based on queue depth
  - Database: Read replicas for query distribution
  - Redis: Clustered for distributed caching
- **Vertical Scaling:** 
  - Individual component scaling based on resource utilization
  - Database vertical scaling for complex queries

### Monitoring and Observability
- **Logging:** Centralized ELK stack or similar
- **Metrics:** Prometheus + Grafana for system metrics
- **Tracing:** OpenTelemetry for request tracing
- **Health Checks:** Kubernetes liveness/readiness probes
- **Alerting:** PagerDuty or similar for critical issues

### Backup and Disaster Recovery
- **Database:** Automated daily backups with point-in-time recovery
- **User Files:** Versioned storage with lifecycle policies
- **Configuration:** Infrastructure as Code for rapid recovery
- **DR Testing:** Quarterly disaster recovery exercises

## Technology Justification

### Frontend Choices
- **React:** Mature ecosystem, strong community, excellent for SPAs
- **TypeScript:** Catch errors early, improve developer experience
- **Vite:** Fast development builds, excellent HMR
- **Tailwind CSS:** Utility-first CSS for rapid UI development
- **Headless UI:** Accessible, unstyled components for custom design
- **@hello-pangea/dnd:** Well-maintained drag-and-drop library
- **Chart.js/Recharts:** Established charting libraries for skills radar
- **diff2html:** Mature library for visual diff representation
- **React Query:** Excellent data synchronization and caching

### Backend Choices
- **Node.js/Express:** Non-blocking I/O ideal for API services, vast npm ecosystem
- **TypeScript:** Consistency with frontend, early error detection
- **Prisma ORM:** Type-safe database access, excellent developer experience
- **PostgreSQL:** ACID compliance, advanced features, strong community
- **BullMQ:** Reliable, feature-rich job queue built on Redis
- **Redis:** High-performance in-memory store for caching and queuing
- **Zod:** Runtime validation with TypeScript inference
- **Winston:** Flexible logging with multiple transports
- **Helmet.js:** Easy implementation of important HTTP headers

### Third-Party Service Choices
- **Auth0/Firebase:** Established, secure authentication with compliance certifications
- **Claude API:** State-of-the-art language model for text analysis tasks
- **AWS/GCP/Azure:** Reliable cloud providers with global presence
- **Supabase (optional):** Open-source Firebase alternative with PostgreSQL

## Future Architecture Considerations

### Microservices Evolution
As the application grows, consider breaking down the monolith:
- Separate AI service into its own scalable service
- Extract resume processing to specialized service
- Consider event-driven architecture with message broker (Apache Kafka/RabbitMQ)
- Implement API Gateway pattern (Kong, Apigee, or custom)

### Advanced Features Architecture
- **Real-time Collaboration:** WebSocket service for team features
- **Advanced Analytics:** Separate data warehouse for reporting (Snowflake/BigQuery)
- **Machine Learning:** Custom model hosting for domain-specific improvements
- **Mobile Applications:** React Native or Flutter sharing business logic
- **Extensions/Plugins:** Webhook system for third-party integrations

### Performance Optimizations
- **Edge Computing:** CDN optimization for static assets
- **Database Read Replicas:** Geographic distribution for global users
- **Application Caching:** Redis caching for expensive computations
- **Asset Optimization:** Image optimization, code splitting, lazy loading
- **Database Query Optimization:** Indexing, query planning, connection pooling

## Conclusion

This architecture provides a solid foundation for the AI Resume & Job Tracker application, balancing:
- **Simplicity:** Straightforward component interactions for rapid development
- **Scalability:** Clear paths for horizontal and vertical scaling
- **Security:** Defense-in-depth with multiple protection layers
- **Maintainability:** Separation of concerns and clear responsibilities
- **Flexibility:** Ability to evolve and add features over time

The design leverages proven technologies and patterns while allowing for innovation in the core AI functionality that differentiates the product.