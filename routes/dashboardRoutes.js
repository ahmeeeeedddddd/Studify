import express from "express";
import db from "../config/db.js";
const router = express.Router();

// Middleware to protect routes
function ensureAuthenticated(req, res, next) {
  console.log("🔒 Auth check - isAuthenticated:", req.isAuthenticated());
  console.log("👤 User:", req.user ? req.user.email : "None");
  
  if (req.isAuthenticated()) {
    return next();
  }
  console.log("❌ Not authenticated, redirecting to signin");
  res.redirect("/signin");
}

// Public routes (no auth needed)
router.get("/", (req, res) => res.render("home.ejs"));
router.get("/register", (req, res) => res.render("register.ejs"));
router.get("/signin", (req, res) => res.render("signin.ejs"));
router.get("/privacy", (req, res) => res.render("privacy.ejs"));
router.get("/test-n8n",(req,res)=>{res.render("test-n8n.ejs")});
router.get("/delete-data", (req, res) => res.render("delete-data.ejs"));

// Protected routes (auth required)
router.get("/course", ensureAuthenticated, (req, res) => {
  console.log("📚 Course page accessed by:", req.user.email);
  res.render("course.ejs");
});



router.get("/roadmap/:userCourseId", ensureAuthenticated, async (req, res) => {
  // Redirect to the query parameter version
  const userCourseId = req.params.userCourseId;
  res.redirect(`/roadmap?id=${userCourseId}`);
});


// UPDATED: Roadmap route with course selection support
router.get("/roadmap", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    const selectedCourseId = req.query.id; // Get from URL parameter ?id=123
    
    console.log("🗺️ Roadmap page accessed by:", req.user.email);
    console.log("🔍 Selected course ID:", selectedCourseId);

    // If no course ID provided, show course selection
    if (!selectedCourseId) {
      // Get all user's courses for selection
      const userCourses = await db.query(`
        SELECT 
          uc.id as user_course_id,
          c.title as course_title,
          c.description,
          uc.custom_duration_days,
          uc.start_date,
          uc.status,
          -- Calculate progress
          COALESCE(
            ROUND(
              (COUNT(CASE WHEN t.is_completed = true THEN 1 END) * 100.0) / 
              NULLIF(COUNT(t.id), 0)
            ), 0
          ) as progress_percent,
          COUNT(t.id) as total_tasks,
          COUNT(CASE WHEN t.is_completed = true THEN 1 END) as completed_tasks
        FROM user_courses uc
        JOIN courses c ON uc.course_id = c.id
        LEFT JOIN daily_plans dp ON uc.id = dp.user_course_id
        LEFT JOIN tasks t ON dp.id = t.daily_plan_id
        WHERE uc.user_id = $1
        GROUP BY uc.id, c.title, c.description, uc.custom_duration_days, uc.start_date, uc.status
        ORDER BY uc.start_date DESC
      `, [userId]);

      if (userCourses.rows.length === 0) {
        return res.render("course.ejs", { 
          courses: [], 
          message: "No courses found. Create your first learning roadmap!" 
        });
      }

      if (userCourses.rows.length === 1) {
        // If only one course, redirect to it directly
        return res.redirect(`/roadmap?id=${userCourses.rows[0].user_course_id}`);
      }

      // Multiple courses - show selection page
      return res.render("course.ejs", { 
        courses: userCourses.rows,
        message: "Select a course to view your roadmap:" 
      });
    }

    // Course ID provided - verify access and render roadmap
    const courseResult = await db.query(`
      SELECT 
        uc.id as user_course_id,
        uc.custom_duration_days,
        uc.start_date,
        uc.status,
        c.title as course_title,
        c.description,
        -- Calculate progress
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN t.is_completed = true THEN 1 END) * 100.0) / 
            NULLIF(COUNT(t.id), 0)
          ), 0
        ) as progress_percent
      FROM user_courses uc
      JOIN courses c ON uc.course_id = c.id
      LEFT JOIN daily_plans dp ON uc.id = dp.user_course_id
      LEFT JOIN tasks t ON dp.id = t.daily_plan_id
      WHERE uc.id = $1 AND uc.user_id = $2
      GROUP BY uc.id, uc.custom_duration_days, uc.start_date, uc.status, c.title, c.description
    `, [selectedCourseId, userId]);

    if (courseResult.rows.length === 0) {
      return res.render("error.ejs", { 
        message: "Course not found or you don't have access to it." 
      });
    }

    const courseData = courseResult.rows[0];
    
    console.log("✅ Loading roadmap for course:", courseData.course_title);
    console.log("📊 Progress:", courseData.progress_percent + "%");

    res.render("roadmap.ejs", { 
      course: courseData,
      userCourseId: selectedCourseId,
      user: req.user
    });

  } catch (error) {
    console.error("❌ Error loading roadmap:", error);
    res.render("error.ejs", { 
      message: "Error loading roadmap. Please try again." 
    });
  }
});

// Dashboard route with course progress
router.get("/dashboard", ensureAuthenticated, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log("🏠 Dashboard accessed by:", req.user.email);

    // Get all user's courses with progress
    const userCourses = await db.query(`
      SELECT 
        uc.id as user_course_id,
        c.title as course_title,
        c.description,
        uc.custom_duration_days,
        uc.start_date,
        uc.status,
        -- Progress calculation
        COALESCE(
          ROUND(
            (COUNT(CASE WHEN t.is_completed = true THEN 1 END) * 100.0) / 
            NULLIF(COUNT(t.id), 0)
          ), 0
        ) as progress_percent,
        COUNT(t.id) as total_tasks,
        COUNT(CASE WHEN t.is_completed = true THEN 1 END) as completed_tasks,
        COUNT(DISTINCT dp.id) as total_days,
        -- Days with all tasks completed
        COUNT(DISTINCT CASE 
          WHEN NOT EXISTS(
            SELECT 1 FROM tasks t2 
            WHERE t2.daily_plan_id = dp.id 
            AND t2.is_completed = false
          ) AND EXISTS(
            SELECT 1 FROM tasks t3 
            WHERE t3.daily_plan_id = dp.id
          )
          THEN dp.id 
        END) as completed_days
      FROM user_courses uc
      JOIN courses c ON uc.course_id = c.id
      LEFT JOIN daily_plans dp ON uc.id = dp.user_course_id
      LEFT JOIN tasks t ON dp.id = t.daily_plan_id
      WHERE uc.user_id = $1
      GROUP BY uc.id, c.title, c.description, uc.custom_duration_days, uc.start_date, uc.status
      ORDER BY uc.start_date DESC
    `, [userId]);

    // Get recent activity (last 5 completed tasks)
    const recentActivity = await db.query(`
      SELECT 
        t.title as task_title,
        c.title as course_title,
        dp.day_number
      FROM tasks t
      JOIN daily_plans dp ON t.daily_plan_id = dp.id
      JOIN user_courses uc ON dp.user_course_id = uc.id
      JOIN courses c ON uc.course_id = c.id
      WHERE uc.user_id = $1 AND t.is_completed = true
      ORDER BY t.id DESC
      LIMIT 5
    `, [userId]);

    console.log(`📊 Found ${userCourses.rows.length} courses for dashboard`);

    res.render("dashboard.ejs", { 
      courses: userCourses.rows,
      recentActivity: recentActivity.rows,
      user: req.user
    });

  } catch (error) {
    console.error("❌ Error loading dashboard:", error);
    res.render("dashboard.ejs", { 
      courses: [],
      recentActivity: [],
      user: req.user,
      error: "Error loading dashboard data"
    });
  }
});

// Other protected routes
router.get("/quiz", ensureAuthenticated, (req, res) => {
  console.log("📝 Quiz page accessed by:", req.user.email);
  res.render("quiz.ejs");
});

router.get("/plans", ensureAuthenticated, (req, res) => {
  console.log("📋 Plans page accessed by:", req.user.email);
  res.render("plans.ejs");
});

router.get("/settings", ensureAuthenticated, (req, res) => {
  console.log("⚙️ Settings page accessed by:", req.user.email);
  res.render("settings.ejs", { 
    user: req.user 
  });
});

// Test route to check authentication status
router.get("/test-auth", (req, res) => {
  res.json({
    isAuthenticated: req.isAuthenticated(),
    user: req.user || null,
    message: req.isAuthenticated() ? "You are signed in!" : "You are NOT signed in"
  });
});

export default router;