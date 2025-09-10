# Studify - AI-Powered Learning Assistant

A web application that creates personalized learning roadmaps using AI automation. Users can specify what they want to learn and receive structured, day-by-day study plans with resources and assessments.

## Features

- **AI-Generated Roadmaps**: Automatic curriculum creation using Gemini API via n8n workflows
- **Personalized Learning Paths**: Custom duration and difficulty levels
- **Progress Tracking**: Visual progress indicators and task completion tracking
- **Daily Study Plans**: Structured day-by-day learning with tasks and resources
- **Interactive Quizzes**: Automated assessments based on learning content
- **User Authentication**: Secure login and profile management
- **Responsive Design**: Works on desktop and mobile devices

## Tech Stack

### Frontend
- HTML5, CSS3, JavaScript (ES6+)
- EJS templating engine
- Responsive CSS Grid/Flexbox

### Backend
- Node.js with Express.js
- PostgreSQL database
- Passport.js for authentication
- bcrypt for password hashing
- express-session for session management

### AI & Automation
- n8n workflow automation platform
- Google Gemini API for content generation
- JSON-based data exchange

### File Upload
- Multer for profile picture uploads
- File validation and storage

## Prerequisites

Before running this project, make sure you have:

- Node.js (v14 or higher)
- PostgreSQL (v12 or higher)
- n8n instance (cloud or self-hosted)
- Google Gemini API access

## Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/yourusername/studify.git
   cd studify
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up PostgreSQL database**:
   - Create a new PostgreSQL database named `studify`
   - Run the SQL schema from the project (found in database setup section)

4. **Configure environment variables**:
   Create a `.env` file in the root directory:
   ```env
   # Database Configuration
   DB_HOST=localhost
   DB_PORT=5432
   DB_NAME=studify
   DB_USER=your_postgres_username
   DB_PASSWORD=your_postgres_password

   # Session Configuration
   SESSION_SECRET=your-super-secret-session-key-change-this-in-production

   # Server Configuration
   PORT=3000
   NODE_ENV=development

   # n8n Webhook URL
   N8N_WEBHOOK_URL=https://your-n8n-instance.app.n8n.cloud/webhook-test/course-selector
   ```

5. **Set up database schema**:
   Run the following SQL commands in your PostgreSQL database:

   ```sql
   -- Users table
   CREATE TABLE users (
       id SERIAL PRIMARY KEY,
       name TEXT NOT NULL,
       email TEXT UNIQUE NOT NULL,
       password_hash TEXT NOT NULL,
       pp_url TEXT,
       created_at TIMESTAMP DEFAULT NOW(),
       updated_at TIMESTAMP DEFAULT NOW()
   );

   -- Courses table
   CREATE TABLE courses (
       id SERIAL PRIMARY KEY,
       title TEXT NOT NULL,
       description TEXT,
       recommended_duration_days INT,
       image_url TEXT,
       created_by_ai BOOLEAN DEFAULT FALSE,
       created_at TIMESTAMP DEFAULT NOW()
   );

   -- User courses relationship
   CREATE TABLE user_courses (
       id SERIAL PRIMARY KEY,
       user_id INT REFERENCES users(id) ON DELETE CASCADE,
       course_id INT REFERENCES courses(id) ON DELETE CASCADE,
       custom_duration_days INT NOT NULL,
       start_date DATE,
       end_date DATE,
       progress_percent FLOAT DEFAULT 0.0,
       status TEXT DEFAULT 'in_progress'
   );

   -- Daily plans
   CREATE TABLE daily_plans (
       id SERIAL PRIMARY KEY,
       user_course_id INT REFERENCES user_courses(id) ON DELETE CASCADE,
       day_number INT NOT NULL,
       date DATE,
       study_hours INT DEFAULT 0,
       plan_type VARCHAR(50) DEFAULT 'regular',
       title TEXT,
       description TEXT
   );

   -- Tasks
   CREATE TABLE tasks (
       id SERIAL PRIMARY KEY,
       daily_plan_id INT REFERENCES daily_plans(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       description TEXT,
       estimated_time INT DEFAULT 0,
       is_completed BOOLEAN DEFAULT FALSE,
       resource_url TEXT
   );

   -- Resources
   CREATE TABLE resources (
       id SERIAL PRIMARY KEY,
       daily_plan_id INTEGER REFERENCES daily_plans(id) ON DELETE CASCADE,
       name TEXT NOT NULL,
       url TEXT NOT NULL,
       resource_type VARCHAR(50) DEFAULT 'link',
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   -- Quizzes
   CREATE TABLE quizzes (
       id SERIAL PRIMARY KEY,
       daily_plan_id INTEGER REFERENCES daily_plans(id) ON DELETE CASCADE,
       title TEXT NOT NULL,
       covers_days_start INTEGER,
       covers_days_end INTEGER,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   -- Quiz questions
   CREATE TABLE quiz_questions (
       id SERIAL PRIMARY KEY,
       quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
       question_text TEXT NOT NULL,
       question_order INTEGER NOT NULL,
       explanation TEXT,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   -- Quiz options
   CREATE TABLE quiz_options (
       id SERIAL PRIMARY KEY,
       question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
       option_text TEXT NOT NULL,
       option_order INTEGER NOT NULL,
       is_correct BOOLEAN DEFAULT FALSE,
       created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
   );

   -- User quiz attempts
   CREATE TABLE user_quiz_attempts (
       id SERIAL PRIMARY KEY,
       user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
       quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
       score INTEGER NOT NULL,
       total_questions INTEGER NOT NULL,
       completed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
       answers JSONB
   );

   -- AI recommendation logs
   CREATE TABLE ai_recommendation_logs (
       id SERIAL PRIMARY KEY,
       user_id INT REFERENCES users(id) ON DELETE CASCADE,
       course_title TEXT NOT NULL,
       user_input_duration INT,
       ai_output JSONB,
       created_at TIMESTAMP DEFAULT NOW()
   );
   ```

6. **Set up n8n workflow**:
   - Configure your n8n instance to receive webhooks
   - Set up Gemini API integration in n8n
   - Configure the webhook endpoint to match your `.env` file

7. **Create uploads directory**:
   ```bash
   mkdir -p public/uploads
   touch public/uploads/.gitkeep
   ```

## Running the Application

1. **Development mode**:
   ```bash
   npm run dev
   ```

2. **Production mode**:
   ```bash
   npm start
   ```

3. **Access the application**:
   Open your browser and navigate to `http://localhost:3000`

## Usage

1. **Register/Login**: Create an account or sign in
2. **Create Course**: Specify what you want to learn and duration
3. **AI Generation**: Wait for AI to generate your personalized roadmap
4. **Follow Roadmap**: Complete daily tasks and track progress
5. **Take Quizzes**: Assessment quizzes are automatically scheduled
6. **Track Progress**: Monitor your learning journey on the dashboard

## API Endpoints

### Authentication
- `POST /auth/register` - User registration
- `POST /auth/signin` - User login
- `POST /auth/signout` - User logout

### Courses & Roadmaps
- `GET /api/my-roadmaps` - Get user's roadmaps
- `POST /api/create-roadmap` - Create new AI roadmap
- `GET /api/roadmap/:userCourseId` - Get specific roadmap
- `PUT /api/task/:taskId/complete` - Mark task complete

### User Management
- `GET /api/user-info` - Get current user info
- `PUT /api/update-profile` - Update user profile
- `POST /api/upload-photo` - Upload profile picture

## Project Structure

```
studify/
├── config/
│   ├── db.js              # Database configuration
│   └── passport.js        # Authentication strategy
├── routes/
│   ├── authRoutes.js      # Authentication routes
│   ├── dashboardRoutes.js # Page routes
│   └── roadmapRoutes.js   # API routes
├── views/
│   ├── dashboard.ejs      # Dashboard page
│   ├── roadmap.ejs        # Roadmap display
│   ├── course.ejs         # Course creation
│   └── ...               # Other pages
├── public/
│   ├── css/
│   │   └── styles.css    # Main stylesheet
│   └── uploads/          # User uploads
├── server.js             # Main server file
├── package.json          # Dependencies
└── README.md            # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature-name`
3. Commit changes: `git commit -am 'Add feature'`
4. Push to branch: `git push origin feature-name`
5. Submit a Pull Request

## Security Considerations

- Change default session secret in production
- Use HTTPS in production
- Implement rate limiting for API endpoints
- Validate and sanitize all user inputs
- Keep dependencies updated

## Troubleshooting

### Common Issues

1. **Database Connection Error**:
   - Verify PostgreSQL is running
   - Check database credentials in `.env`
   - Ensure database exists

2. **n8n Webhook Not Working**:
   - Verify n8n instance is accessible
   - Check webhook URL in `.env`
   - Test n8n workflow independently

3. **File Upload Issues**:
   - Check `public/uploads` directory permissions
   - Verify multer configuration
   - Ensure sufficient disk space


For support, please open an issue on GitHub or contact the development team.
