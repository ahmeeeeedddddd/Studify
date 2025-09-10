import express from "express";
import db from "../config/db.js";
import fetch from "node-fetch";

const router = express.Router();


import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadDir = 'public/uploads';
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'profile-' + uniqueSuffix + path.extname(file.originalname));
  }
});

// File filter to only allow images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed!'), false);
  }
};

const upload = multer({ 
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});


// Middleware to ensure user is authenticated for API calls
function ensureAuthenticatedAPI(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  return res.status(401).json({ error: "Authentication required" });
}

// Enhanced fetch with timeout for n8n calls
async function fetchWithTimeout(url, options = {}, timeoutMs = 180000) { // 3 minutes timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      // Add headers for better connection handling
      headers: {
        ...options.headers,
        'Connection': 'keep-alive',
        'Keep-Alive': 'timeout=300'
      }
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error.name === 'AbortError') {
      throw new Error('n8n request timed out after 3 minutes');
    }
    throw error;
  }
}

// Test endpoint to check n8n connectivity
router.get("/api/test-n8n", ensureAuthenticatedAPI, async (req, res) => {
  try {
    console.log("🔍 Testing n8n connectivity...");
    
    const testPayload = {
      course: "Test Course",
      durationType: "recommended",
      customDays: null
    };

    const response = await fetchWithTimeout("https://mhlbya.app.n8n.cloud/webhook-test/course-selector", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Studify-Backend/1.0"
      },
      body: JSON.stringify(testPayload)
    }, 30000); // 30 second timeout for test

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${await response.text()}`);
    }

    const result = await response.json();
    console.log("✅ n8n connectivity test passed");
    
    res.json({
      success: true,
      message: "n8n service is reachable",
      status: response.status,
      hasResult: !!result
    });

  } catch (error) {
    console.error("❌ n8n connectivity test failed:", error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: {
        name: error.name,
        code: error.code,
        cause: error.cause
      }
    });
  }
});


// POST /api/create-roadmap - Create new roadmap (UPDATED VERSION)
// REPLACE your /api/create-roadmap route in roadmapRoutes.js with this fixed version:

router.post("/api/create-roadmap", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { course, durationType, customDays } = req.body;
    const userId = req.user.id;
    
    console.log("🚀 Creating roadmap for user:", req.user.email);
    console.log("📚 Course data:", { course, durationType, customDays });

    // Step 1: Call n8n webhook with enhanced timeout handling
    console.log("⏱️ Calling n8n webhook (may take up to 3 minutes)...");
    const startTime = Date.now();
    
    let aiResult;
    try {
      const n8nResponse = await fetchWithTimeout("https://mhlbya.app.n8n.cloud/webhook-test/course-selector", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ course, durationType, customDays })
      }, 180000); // 3 minutes timeout

      const responseTime = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`✅ n8n response received in ${responseTime} seconds`);

      if (!n8nResponse.ok) {
        const errorText = await n8nResponse.text().catch(() => '');
        console.error(`❌ n8n API error ${n8nResponse.status}:`, errorText);
        throw new Error(`n8n API error: ${n8nResponse.status} - ${errorText || 'Unknown error'}`);
      }

      aiResult = await n8nResponse.json();
      console.log("🤖 AI response received and parsed successfully");

    } catch (error) {
      console.error("💥 n8n call failed:", error.message);
      
      // Provide more specific error messages
      if (error.message.includes('timed out')) {
        throw new Error('The AI is taking longer than expected to generate your roadmap. Please try again in a few minutes.');
      } else if (error.message.includes('524')) {
        throw new Error('Our AI service is experiencing high load. Please try again in a moment.');
      } else {
        throw new Error(`AI service unavailable: ${error.message}`);
      }
    }

    // DEBUG: Log the raw n8n response
    console.log("🤖 RAW aiResult from n8n:", JSON.stringify(aiResult, null, 2));

    // Step 2: Parse AI response to get daily plan
    let aiResponse = "";
    
    // Handle n8n response format
    if (aiResult.result) {
      console.log("📄 Found aiResult.result");
      try {
        aiResponse = JSON.parse(aiResult.result);
        console.log("✅ Successfully parsed aiResult.result as JSON");
      } catch (e) {
        console.log("⚠️ aiResult.result is not JSON, using as string");
        aiResponse = aiResult.result;
      }
    } else if (Array.isArray(aiResult) && aiResult[0]?.content?.parts?.[0]?.text) {
      console.log("📄 Found Gemini-style response");
      aiResponse = aiResult[0].content.parts[0].text;
    } else {
      console.log("📄 Using aiResult directly");
      aiResponse = aiResult;
    }

    console.log("🔍 Final aiResponse for parsing:", typeof aiResponse);

    console.log("📝 Parsing AI response into daily plans...");

    // Parse and save daily plans with enhanced support
    const dailyPlans = parseAIResponseToDailyPlans(aiResponse);
    console.log(`📅 PARSED DAILY PLANS COUNT: ${dailyPlans.length}`);
    console.log(`📅 FIRST 3 DAILY PLANS:`, JSON.stringify(dailyPlans.slice(0, 3), null, 2));

    if (dailyPlans.length === 30 && dailyPlans[0].title && dailyPlans[0].title.includes("Day 1 Learning")) {
      console.log("⚠️ WARNING: Using fallback plans! AI parsing failed.");
    }

    // Step 3: Save to database
    // First, create or get the course
    const courseResult = await db.query(`
      INSERT INTO courses (title, description, recommended_duration_days, created_by_ai)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (title) DO UPDATE SET title = EXCLUDED.title
      RETURNING id
    `, [course, `AI-generated course for ${course}`, customDays || 30, true]);
    
    const courseId = courseResult.rows[0].id;

    // Create user_course entry
    const userCourseResult = await db.query(`
      INSERT INTO user_courses (user_id, course_id, custom_duration_days, start_date, status)
      VALUES ($1, $2, $3, CURRENT_DATE, 'in_progress')
      RETURNING id
    `, [userId, courseId, customDays || 30]);
    
    const userCourseId = userCourseResult.rows[0].id;

    // Use the enhanced saving function
    await saveDailyPlansToDatabase(userCourseId, dailyPlans);

    // Log the AI recommendation
    await db.query(`
      INSERT INTO ai_recommendation_logs (user_id, course_title, user_input_duration, ai_output)
      VALUES ($1, $2, $3, $4)
    `, [userId, course, customDays, JSON.stringify(aiResult)]);

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`✅ Roadmap saved to database. Total processing time: ${totalTime} seconds`);
    
    // Return success response
    res.json({
      success: true,
      message: "Roadmap created successfully",
      userCourseId: userCourseId,
      courseTitle: course,
      processingTime: totalTime
    });

  } catch (error) {
    console.error("💥 Error creating roadmap:", error);
    
    // Return appropriate error response
    const statusCode = error.message.includes('Authentication required') ? 401 : 
                      error.message.includes('not found') ? 404 : 500;
    
    res.status(statusCode).json({ 
      error: "Failed to create roadmap",
      details: error.message 
    });
  }
});

// GET /api/roadmap/:userCourseId - Get specific roadmap (ENHANCED VERSION)
// Alternative approach using subqueries to avoid duplicates
router.get("/api/roadmap/:userCourseId", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { userCourseId } = req.params;
    const userId = req.user.id;

    // Verify this roadmap belongs to the current user
    const roadmapQuery = `
      SELECT 
        uc.id as user_course_id,
        uc.custom_duration_days,
        uc.start_date,
        uc.progress_percent,
        uc.status,
        c.title as course_title,
        c.description
      FROM user_courses uc
      JOIN courses c ON uc.course_id = c.id
      WHERE uc.id = $1 AND uc.user_id = $2
    `;
    
    const roadmapResult = await db.query(roadmapQuery, [userCourseId, userId]);
    
    if (roadmapResult.rows.length === 0) {
      return res.status(404).json({ error: "Roadmap not found" });
    }

    const roadmap = roadmapResult.rows[0];

    // Get daily plans first
    const plansQuery = `
      SELECT 
        dp.id as daily_plan_id,
        dp.day_number,
        dp.study_hours,
        dp.plan_type,
        dp.title as plan_title,
        dp.description as plan_description,
        -- Quiz info
        CASE WHEN q.id IS NOT NULL THEN
          json_build_object(
            'id', q.id,
            'title', q.title,
            'covers_days_start', q.covers_days_start,
            'covers_days_end', q.covers_days_end
          )
        END as quiz
      FROM daily_plans dp
      LEFT JOIN quizzes q ON dp.id = q.daily_plan_id
      WHERE dp.user_course_id = $1
      ORDER BY dp.day_number
    `;
    
    const plansResult = await db.query(plansQuery, [userCourseId]);

    // Get tasks for each daily plan
    const tasksQuery = `
      SELECT 
        daily_plan_id,
        json_agg(
          json_build_object(
            'id', id,
            'title', title,
            'description', description,
            'estimated_time', estimated_time,
            'is_completed', is_completed,
            'resource_url', resource_url
          )
        ) as tasks
      FROM tasks
      WHERE daily_plan_id = ANY($1)
      GROUP BY daily_plan_id
    `;

    // Get resources for each daily plan
    const resourcesQuery = `
      SELECT 
        daily_plan_id,
        json_agg(
          json_build_object(
            'id', id,
            'name', name,
            'url', url,
            'type', resource_type
          )
        ) as resources
      FROM resources
      WHERE daily_plan_id = ANY($1)
      GROUP BY daily_plan_id
    `;

    const dailyPlanIds = plansResult.rows.map(p => p.daily_plan_id);
    
    const [tasksResult, resourcesResult] = await Promise.all([
      dailyPlanIds.length > 0 ? db.query(tasksQuery, [dailyPlanIds]) : { rows: [] },
      dailyPlanIds.length > 0 ? db.query(resourcesQuery, [dailyPlanIds]) : { rows: [] }
    ]);

    // Combine the results
    const tasksMap = new Map(tasksResult.rows.map(r => [r.daily_plan_id, r.tasks]));
    const resourcesMap = new Map(resourcesResult.rows.map(r => [r.daily_plan_id, r.resources]));

    const dailyPlans = plansResult.rows.map(plan => ({
      ...plan,
      tasks: tasksMap.get(plan.daily_plan_id) || [],
      resources: resourcesMap.get(plan.daily_plan_id) || []
    }));

    res.json({
      roadmap: roadmap,
      dailyPlans: dailyPlans
    });

  } catch (error) {
    console.error("💥 Error fetching roadmap:", error);
    res.status(500).json({ 
      error: "Failed to fetch roadmap",
      details: error.message 
    });
  }
});

// GET /api/quiz/:userCourseId/:dayNumber - Get quiz for specific day (RESTORED)
router.get("/api/quiz/:userCourseId/:dayNumber", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { userCourseId, dayNumber } = req.params;
    const userId = req.user.id;

    // Verify this roadmap belongs to the current user and get the quiz
    const quizQuery = `
      SELECT 
        q.id as quiz_id,
        q.title,
        q.covers_days_start,
        q.covers_days_end,
        c.title as course_title,
        dp.day_number
      FROM quizzes q
      JOIN daily_plans dp ON q.daily_plan_id = dp.id
      JOIN user_courses uc ON dp.user_course_id = uc.id
      JOIN courses c ON uc.course_id = c.id
      WHERE uc.id = $1 AND uc.user_id = $2 AND dp.day_number = $3
    `;
    
    const quizResult = await db.query(quizQuery, [userCourseId, userId, dayNumber]);
    
    if (quizResult.rows.length === 0) {
      return res.status(404).json({ error: "Quiz not found for this day" });
    }

    const quiz = quizResult.rows[0];

    // Get quiz questions and options
    const questionsQuery = `
      SELECT 
        qq.id as question_id,
        qq.question_text,
        qq.question_order,
        qq.explanation,
        array_agg(
          json_build_object(
            'id', qo.id,
            'text', qo.option_text,
            'order', qo.option_order,
            'is_correct', qo.is_correct
          ) ORDER BY qo.option_order
        ) as options
      FROM quiz_questions qq
      LEFT JOIN quiz_options qo ON qq.id = qo.question_id
      WHERE qq.quiz_id = $1
      GROUP BY qq.id, qq.question_text, qq.question_order, qq.explanation
      ORDER BY qq.question_order
    `;
    
    const questionsResult = await db.query(questionsQuery, [quiz.quiz_id]);

    // Format for frontend
    const formattedQuiz = {
      title: quiz.title,
      day_range: `Days ${quiz.covers_days_start}-${quiz.covers_days_end}`,
      course_title: quiz.course_title,
      questions: questionsResult.rows.map(q => ({
        question: q.question_text,
        options: q.options.map(opt => opt.text),
        correct_answer: q.options.findIndex(opt => opt.is_correct),
        explanation: q.explanation
      }))
    };

    res.json(formattedQuiz);

  } catch (error) {
    console.error("Error fetching quiz:", error);
    res.status(500).json({ 
      error: "Failed to fetch quiz",
      details: error.message 
    });
  }
});



// GET /api/my-roadmaps - Get all user's roadmaps
router.get("/api/my-roadmaps", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const userId = req.user.id;
    
    const query = `
      SELECT 
        uc.id as user_course_id,
        c.title as course_title,
        c.description,
        uc.custom_duration_days,
        uc.start_date,
        uc.progress_percent,
        uc.status,
        COUNT(dp.id) as total_days,
        COUNT(CASE WHEN EXISTS(
          SELECT 1 FROM tasks t 
          WHERE t.daily_plan_id = dp.id 
          AND NOT EXISTS(SELECT 1 FROM tasks t2 WHERE t2.daily_plan_id = dp.id AND t2.is_completed = false)
        ) THEN 1 END) as completed_days
      FROM user_courses uc
      JOIN courses c ON uc.course_id = c.id
      LEFT JOIN daily_plans dp ON uc.id = dp.user_course_id
      WHERE uc.user_id = $1
      GROUP BY uc.id, c.title, c.description, uc.custom_duration_days, uc.start_date, uc.progress_percent, uc.status
      ORDER BY uc.created_at DESC
    `;
    
    const result = await db.query(query, [userId]);
    res.json({ roadmaps: result.rows });

  } catch (error) {
    console.error("💥 Error fetching user roadmaps:", error);
    res.status(500).json({ 
      error: "Failed to fetch roadmaps",
      details: error.message 
    });
  }
});

function processDailyPlanArray(dailyPlans) {
  console.log(`🔄 Processing ${dailyPlans.length} daily plans...`);
  
  return dailyPlans.map(plan => {
    // Handle quiz data properly
    let planType = 'regular';
    let quizData = null;
    
    if (plan.type === 'quiz' || plan.type === 'final_exam') {
      planType = plan.type;
      if (plan.quiz_data) {
        quizData = {
          title: plan.title,
          covers_days_start: plan.quiz_data.covers_days ? plan.quiz_data.covers_days[0] : plan.day,
          covers_days_end: plan.quiz_data.covers_days ? plan.quiz_data.covers_days[1] : plan.day,
          questions: plan.quiz_data.questions || []
        };
      }
    }
    
    // Extract estimated hours
    let estimatedHours = 2; // default
    if (plan.estimated_time) {
      const hourMatch = plan.estimated_time.match(/(\d+(?:\.\d+)?)/);
      if (hourMatch) {
        estimatedHours = parseFloat(hourMatch[1]);
      }
    }
    
    return {
      day: plan.day,
      title: plan.title,
      description: plan.description || null,
      topics: plan.topics || [],
      estimatedHours: estimatedHours,
      planType: planType,
      ...(quizData && { quiz: quizData }),
      ...(plan.resources && { resources: plan.resources.map(r => ({
        name: r.name,
        url: r.link || r.url,
        type: 'link'
      })) })
    };
  });
}


function parseAIResponseToDailyPlans(aiResponse) {
  console.log('🔍 Parsing AI response:', typeof aiResponse);
  
  let parsedData = null;
  
  if (typeof aiResponse === 'object' && aiResponse !== null) {
    parsedData = aiResponse;
  } else if (typeof aiResponse === 'string') {
    let cleanResponse = aiResponse;
    
    // Remove markdown code blocks
    if (aiResponse.includes('```json')) {
      cleanResponse = aiResponse.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
    }
    
    // FIRST: Check if the JSON is truncated/incomplete
    if (cleanResponse.includes('"daily_plan"') && !cleanResponse.trim().endsWith('}')) {
      console.log('⚠️ JSON appears to be truncated, attempting repair...');
      cleanResponse = repairTruncatedJSON(cleanResponse);
    }
    
    try {
      // Try parsing as-is first
      parsedData = JSON.parse(cleanResponse);
      console.log('✅ Successfully parsed JSON response');
    } catch (e) {
      console.log('❌ JSON parsing failed:', e.message);
      console.log('🔄 Using fallback plans due to parsing failure');
      return createFallbackPlans(30);
    }
  }
  
  // Process the parsed data
  if (parsedData && parsedData.daily_plan && Array.isArray(parsedData.daily_plan)) {
    console.log(`📅 Found daily_plan array with ${parsedData.daily_plan.length} days`);
    
    // Validate the array isn't empty or corrupted
    if (parsedData.daily_plan.length === 0) {
      console.log('⚠️ Empty daily plan array, using fallback');
      return createFallbackPlans(30);
    }
    
    // Check first few items for validity
    const firstDay = parsedData.daily_plan[0];
    if (!firstDay || !firstDay.day || !firstDay.title || firstDay.title.length < 5) {
      console.log('⚠️ Invalid daily plan data detected, using fallback');
      return createFallbackPlans(30);
    }
    
    return processDailyPlanArray(parsedData.daily_plan);
  }
  
  console.log('⚠️ No valid daily plan found, using fallback');
  return createFallbackPlans(30);
}

function repairTruncatedJSON(jsonString) {
  console.log('🔧 Attempting to repair truncated JSON...');
  
  // Find the daily_plan array
  const dailyPlanStart = jsonString.indexOf('"daily_plan":');
  if (dailyPlanStart === -1) {
    throw new Error('No daily_plan found in JSON');
  }
  
  const arrayStart = jsonString.indexOf('[', dailyPlanStart);
  if (arrayStart === -1) {
    throw new Error('No array start found');
  }
  
  // Find the last complete day object
  let lastCompleteDay = arrayStart;
  let bracketCount = 0;
  let inString = false;
  let escapeNext = false;
  let lastValidEnd = arrayStart;
  
  for (let i = arrayStart; i < jsonString.length; i++) {
    const char = jsonString[i];
    
    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    
    if (char === '"' && !escapeNext) {
      inString = !inString;
      continue;
    }
    
    if (!inString) {
      if (char === '{') bracketCount++;
      if (char === '}') {
        bracketCount--;
        // If we've closed a day object and we're back at array level
        if (bracketCount === 0) {
          lastValidEnd = i;
        }
      }
    }
  }
  
  // Extract up to the last complete day object
  let repairedJson = jsonString.substring(0, lastValidEnd + 1);
  
  // Close the array and main object
  repairedJson += ']}';
  
  console.log('🔧 Repaired JSON length:', repairedJson.length);
  return repairedJson;
}

// Parse text format as fallback
function parseTextFormat(aiResponse) {
  console.log('📝 Attempting text format parsing');
  const plans = [];
  
  // Try multiple day pattern formats
  const dayPatterns = [
    /Day (\d+):(.*?)(?=Day \d+:|$)/gs,
    /Day (\d+)\s*[-–—]\s*(.*?)(?=Day \d+|$)/gs,
    /(\d+)\.\s*(.*?)(?=\d+\.|$)/gs
  ];
  
  let foundDays = false;
  
  for (const pattern of dayPatterns) {
    const matches = [...aiResponse.matchAll(pattern)];
    
    if (matches.length > 0) {
      console.log(`📊 Found ${matches.length} days using pattern`);
      foundDays = true;
      
      matches.forEach(match => {
        const dayNumber = parseInt(match[1]);
        const content = match[2].trim();
        
        plans.push({
          day: dayNumber,
          title: extractTitle(content) || `Day ${dayNumber}`,
          topics: extractTopicsFromText(content),
          estimatedHours: extractHours(content) || 2,
          planType: content.toLowerCase().includes('quiz') || content.toLowerCase().includes('exam') ? 'quiz' : 'regular'
        });
      });
      break;
    }
  }
  
  if (!foundDays) {
    console.log('⚠️ No recognizable day patterns found in text');
    return createFallbackPlans();
  }
  
  return plans.length > 0 ? plans : createFallbackPlans();
}


function createFallbackPlans(days = 30) {
  console.log(`🔄 Creating ${days} fallback daily plans`);
  const plans = [];
  
  for (let i = 1; i <= days; i++) {
    let planType = 'regular';
    let topics = ["Complete assigned reading", "Practice exercises", "Review concepts"];
    
    // Add quizzes every 7 days and a final exam
    if (i % 7 === 0 && i < days) {
      planType = 'quiz';
      topics = [`Take quiz covering Days ${i-6}-${i}`];
    } else if (i === days) {
      planType = 'final_exam';
      topics = [`Final examination covering all course material`];
    }
    
    plans.push({
      day: i,
      title: planType === 'quiz' ? `Week ${Math.ceil(i/7)} Quiz` : 
             planType === 'final_exam' ? `Final Examination` : 
             `Day ${i} Learning`,
      topics: topics,
      estimatedHours: planType === 'quiz' || planType === 'final_exam' ? 1 : 2,
      planType: planType,
      // Add quiz data for quiz days
      ...(planType === 'quiz' || planType === 'final_exam' ? {
        quiz: {
          title: planType === 'quiz' ? `Week ${Math.ceil(i/7)} Quiz` : 'Final Examination',
          covers_days_start: planType === 'quiz' ? (i-6) : 1,
          covers_days_end: i,
          questions: [] // Will be populated by AI if needed
        }
      } : {})
    });
  }
  
  return plans;
}
// Enhanced database saving function
// REPLACE the saveDailyPlansToDatabase function in your roadmapRoutes.js with this:

async function saveDailyPlansToDatabase(userCourseId, dailyPlans) {
  console.log(`💾 Saving ${dailyPlans.length} daily plans to database...`);
  
  for (const plan of dailyPlans) {
    try {
      // Ensure study_hours is an integer or convert decimal to integer
      const studyHours = plan.estimatedHours ? Math.round(parseFloat(plan.estimatedHours)) : 2;
      
      console.log(`📝 Saving day ${plan.day}: "${plan.title}" with ${studyHours} hours`);
      
      // Insert daily plan with enhanced data
      const dailyPlanResult = await db.query(`
        INSERT INTO daily_plans (user_course_id, day_number, study_hours, plan_type, title, description)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id
      `, [
        userCourseId, 
        plan.day, 
        studyHours,  // Now guaranteed to be integer
        plan.planType || 'regular',
        plan.title || null,
        plan.description || null
      ]);
      
      const dailyPlanId = dailyPlanResult.rows[0].id;
      console.log(`✅ Created daily plan ${plan.day} with ID: ${dailyPlanId}`);
      
      // Insert tasks
      if (plan.topics && plan.topics.length > 0) {
        console.log(`📋 Adding ${plan.topics.length} tasks for day ${plan.day}`);
        for (const topic of plan.topics) {
          await db.query(`
            INSERT INTO tasks (daily_plan_id, title, estimated_time)
            VALUES ($1, $2, $3)
          `, [dailyPlanId, topic, 60]);
        }
      }
      
      // Insert quiz if present
      if (plan.quiz && plan.quiz.questions && plan.quiz.questions.length > 0) {
        console.log(`🧠 Adding quiz for day ${plan.day}`);
        const quizResult = await db.query(`
          INSERT INTO quizzes (daily_plan_id, title, covers_days_start, covers_days_end)
          VALUES ($1, $2, $3, $4)
          RETURNING id
        `, [
          dailyPlanId,
          plan.quiz.title,
          plan.quiz.covers_days_start,
          plan.quiz.covers_days_end
        ]);
        
        const quizId = quizResult.rows[0].id;
        
        // Insert quiz questions and options
        for (let i = 0; i < plan.quiz.questions.length; i++) {
          const question = plan.quiz.questions[i];
          
          const questionResult = await db.query(`
            INSERT INTO quiz_questions (quiz_id, question_text, question_order, explanation)
            VALUES ($1, $2, $3, $4)
            RETURNING id
          `, [
            quizId,
            question.question || question.text,
            i + 1,
            question.explanation || null
          ]);
          
          const questionId = questionResult.rows[0].id;
          
          // Insert options
          if (question.options && Array.isArray(question.options)) {
            for (let j = 0; j < question.options.length; j++) {
              const option = question.options[j];
              await db.query(`
                INSERT INTO quiz_options (question_id, option_text, option_order, is_correct)
                VALUES ($1, $2, $3, $4)
              `, [
                questionId,
                typeof option === 'string' ? option : option.text,
                j + 1,
                j === question.correct_answer || (typeof option === 'object' && option.is_correct)
              ]);
            }
          }
        }
      }
      
      // Insert resources if present
      if (plan.resources && Array.isArray(plan.resources)) {
        console.log(`📚 Adding ${plan.resources.length} resources for day ${plan.day}`);
        for (const resource of plan.resources) {
          await db.query(`
            INSERT INTO resources (daily_plan_id, name, url, resource_type)
            VALUES ($1, $2, $3, $4)
          `, [
            dailyPlanId,
            resource.name,
            resource.url,
            resource.type || 'link'
          ]);
        }
      }
      
    } catch (error) {
      console.error(`💥 Error saving day ${plan.day}:`, error);
      throw error; // Re-throw to stop the process
    }
  }
  
  console.log('✅ All daily plans saved successfully');
}

function extractTopicsFromText(content) {
  const topics = [];
  const lines = content.split('\n');
  
  lines.forEach(line => {
    const trimmed = line.trim();
    // Look for bullet points, dashes, or numbered items
    if (trimmed.match(/^[-•*]\s+/) || trimmed.match(/^\d+[\.\)]\s+/)) {
      const topic = trimmed.replace(/^[-•*]\s+/, '').replace(/^\d+[\.\)]\s+/, '').trim();
      if (topic && topic.length > 3) {
        topics.push(topic);
      }
    }
  });
  
  return topics.length > 0 ? topics : ["Complete assigned reading", "Practice exercises", "Review concepts"];
}

function extractTitle(content) {
  const lines = content.split('\n');
  const firstLine = lines[0]?.trim();
  
  // If first line is short and doesn't have bullet points, use it as title
  if (firstLine && firstLine.length < 100 && !firstLine.match(/^[-•*]\s+/)) {
    return firstLine;
  }
  
  return null;
}

function extractHours(timeString) {
  if (!timeString) return null;
  
  const str = timeString.toString().toLowerCase();
  
  // Look for patterns like "1 hour", "1.5 hours", "30 minutes"
  const hourMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h\b)/i);
  if (hourMatch) {
    return parseFloat(hourMatch[1]);
  }
  
  const minuteMatch = str.match(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?|m\b)/i);
  if (minuteMatch) {
    return Math.round(parseFloat(minuteMatch[1]) / 60 * 10) / 10; // Convert to hours, round to 1 decimal
  }
  
  return null;
}

// PUT /api/task/:taskId/complete - Update task completion status
router.put("/api/task/:taskId/complete", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { taskId } = req.params;
    const { is_completed } = req.body;
    const userId = req.user.id;

    console.log(`📝 Updating task ${taskId} completion:`, is_completed);

    // First verify this task belongs to the current user
    const verifyQuery = `
      SELECT t.id, t.title 
      FROM tasks t
      JOIN daily_plans dp ON t.daily_plan_id = dp.id
      JOIN user_courses uc ON dp.user_course_id = uc.id
      WHERE t.id = $1 AND uc.user_id = $2
    `;
    
    const verifyResult = await db.query(verifyQuery, [taskId, userId]);
    
    if (verifyResult.rows.length === 0) {
      return res.status(404).json({ error: "Task not found or access denied" });
    }

    // Update the task
    const updateResult = await db.query(
      "UPDATE tasks SET is_completed = $1 WHERE id = $2 RETURNING *",
      [is_completed, taskId]
    );

    console.log(`✅ Task updated:`, updateResult.rows[0].title);

    res.json({ 
      success: true, 
      task: updateResult.rows[0],
      message: `Task ${is_completed ? 'completed' : 'uncompleted'}` 
    });

  } catch (error) {
    console.error("💥 Error updating task:", error);
    res.status(500).json({ 
      error: "Failed to update task",
      details: error.message 
    });
  }
});




// ADD these new routes to your existing roadmapRoutes.js file:

// PUT /api/day/:dailyPlanId/complete - Mark entire day as complete
router.put("/api/day/:dailyPlanId/complete", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { dailyPlanId } = req.params;
    const { is_completed } = req.body;
    const userId = req.user.id;

    console.log(`📅 Updating day ${dailyPlanId} completion:`, is_completed);

    // Verify this day belongs to the current user
    const verifyQuery = `
      SELECT dp.id, dp.day_number, c.title 
      FROM daily_plans dp
      JOIN user_courses uc ON dp.user_course_id = uc.id
      JOIN courses c ON uc.course_id = c.id
      WHERE dp.id = $1 AND uc.user_id = $2
    `;
    
    const verifyResult = await db.query(verifyQuery, [dailyPlanId, userId]);
    
    if (verifyResult.rows.length === 0) {
      return res.status(404).json({ error: "Day not found or access denied" });
    }

    // Update the daily plan completion status
    const updateResult = await db.query(
      "UPDATE daily_plans SET is_completed = $1, completed_at = $2 WHERE id = $3 RETURNING *",
      [is_completed, is_completed ? new Date() : null, dailyPlanId]
    );

    // Update user_courses progress
    await updateCourseProgress(verifyResult.rows[0], userId);

    console.log(`✅ Day ${verifyResult.rows[0].day_number} completion updated`);

    res.json({ 
      success: true, 
      dailyPlan: updateResult.rows[0],
      message: `Day ${is_completed ? 'completed' : 'uncompleted'}` 
    });

  } catch (error) {
    console.error("💥 Error updating day completion:", error);
    res.status(500).json({ 
      error: "Failed to update day completion",
      details: error.message 
    });
  }
});

// GET /api/progress/:userCourseId - Get detailed progress info
router.get("/api/progress/:userCourseId", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { userCourseId } = req.params;
    const userId = req.user.id;

    const progressQuery = `
      SELECT 
        uc.id,
        uc.progress_percent,
        uc.days_completed,
        uc.total_days,
        COUNT(dp.id) as actual_total_days,
        COUNT(CASE WHEN dp.is_completed = true THEN 1 END) as actual_completed_days,
        COUNT(CASE WHEN EXISTS(SELECT 1 FROM quizzes q WHERE q.daily_plan_id = dp.id) THEN 1 END) as total_quizzes,
        COUNT(CASE WHEN EXISTS(
          SELECT 1 FROM quizzes q 
          JOIN user_quiz_attempts uqa ON q.id = uqa.quiz_id 
          WHERE q.daily_plan_id = dp.id AND uqa.user_id = $2
        ) THEN 1 END) as completed_quizzes
      FROM user_courses uc
      LEFT JOIN daily_plans dp ON uc.id = dp.user_course_id
      WHERE uc.id = $1 AND uc.user_id = $2
      GROUP BY uc.id, uc.progress_percent, uc.days_completed, uc.total_days
    `;
    
    const result = await db.query(progressQuery, [userCourseId, userId]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({ progress: result.rows[0] });

  } catch (error) {
    console.error("💥 Error fetching progress:", error);
    res.status(500).json({ 
      error: "Failed to fetch progress",
      details: error.message 
    });
  }
});

// Helper function to update course progress
async function updateCourseProgress(dayInfo, userId) {
  try {
    // Get user course ID from the day info
    const userCourseQuery = `
      SELECT uc.id as user_course_id
      FROM user_courses uc
      JOIN daily_plans dp ON uc.id = dp.user_course_id
      WHERE dp.id = $1 AND uc.user_id = $2
    `;
    
    const userCourseResult = await db.query(userCourseQuery, [dayInfo.id, userId]);
    if (userCourseResult.rows.length === 0) return;
    
    const userCourseId = userCourseResult.rows[0].user_course_id;

    // Calculate progress
    const progressQuery = `
      SELECT 
        COUNT(dp.id) as total_days,
        COUNT(CASE WHEN dp.is_completed = true THEN 1 END) as completed_days
      FROM daily_plans dp
      WHERE dp.user_course_id = $1
    `;
    
    const progressResult = await db.query(progressQuery, [userCourseId]);
    const progress = progressResult.rows[0];
    
    const progressPercent = progress.total_days > 0 
      ? Math.round((progress.completed_days / progress.total_days) * 100) 
      : 0;

    // Update user_courses table
    await db.query(`
      UPDATE user_courses 
      SET 
        progress_percent = $1, 
        days_completed = $2, 
        total_days = $3,
        updated_at = NOW()
      WHERE id = $4
    `, [progressPercent, progress.completed_days, progress.total_days, userCourseId]);

    console.log(`📊 Updated progress: ${progress.completed_days}/${progress.total_days} (${progressPercent}%)`);
    
  } catch (error) {
    console.error("💥 Error updating course progress:", error);
  }
}

// PUT /api/sync-progress/:userCourseId - Manually sync progress to database
router.put("/api/sync-progress/:userCourseId", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const { userCourseId } = req.params;
    const { progress_percent } = req.body;
    const userId = req.user.id;

    console.log(`Syncing progress for course ${userCourseId}: ${progress_percent}%`);

    // Verify ownership and update
    const updateResult = await db.query(`
      UPDATE user_courses 
      SET progress_percent = $1, updated_at = NOW()
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `, [progress_percent, userCourseId, userId]);

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json({ success: true, progress: updateResult.rows[0] });

  } catch (error) {
    console.error("Error syncing progress:", error);
    res.status(500).json({ error: "Failed to sync progress" });
  }
});


// Photo upload endpoint
router.post('/api/upload-photo', ensureAuthenticatedAPI, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No photo uploaded' });
        }
        
        const photoUrl = `/uploads/${req.file.filename}`;
        
        // Update user's profile photo in database
        await db.query('UPDATE users SET pp_url = $1, updated_at = NOW() WHERE id = $2', 
                      [photoUrl, req.user.id]);
        
        res.json({ photoUrl });
        
    } catch (error) {
        console.error('Photo upload error:', error);
        res.status(500).json({ error: 'Failed to upload photo' });
    }
});

// Profile update endpoint
router.put('/api/update-profile', ensureAuthenticatedAPI, async (req, res) => {
    try {
        const { name, email } = req.body;
        const userId = req.user.id;
        
        // Check if email is already taken by another user
        const emailCheck = await db.query(
            'SELECT id FROM users WHERE email = $1 AND id != $2', 
            [email, userId]
        );
        
        if (emailCheck.rows.length > 0) {
            return res.status(400).json({ error: 'Email is already taken' });
        }
        
        // Update user profile
        const result = await db.query(
            'UPDATE users SET name = $1, email = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
            [name, email, userId]
        );
        
        res.json({ success: true, user: result.rows[0] });
        
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
    }
});


// GET /api/user-info - Get current user info
router.get("/api/user-info", ensureAuthenticatedAPI, async (req, res) => {
  try {
    const result = await db.query(
      'SELECT id, name, email, pp_url FROM users WHERE id = $1',
      [req.user.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.json(result.rows[0]);
    
  } catch (error) {
    console.error('Error fetching user info:', error);
    res.status(500).json({ error: 'Failed to fetch user info' });
  }
});

export default router;