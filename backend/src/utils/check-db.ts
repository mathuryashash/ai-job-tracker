import prisma from '../prisma/index';

async function checkDb() {
  try {
    const usersCount = await prisma.user.count();
    console.log(`Users count: ${usersCount}`);

    const users = await prisma.user.findMany();
    for (const u of users) {
      console.log(`User: ID=${u.id}, Email=${u.email}, Preferences=${JSON.stringify(u.preferences)}`);
    }

    const resumesCount = await prisma.resume.count();
    console.log(`Resumes count: ${resumesCount}`);

    const resumes = await prisma.resume.findMany();
    for (const r of resumes) {
      console.log(`Resume: ID=${r.id}, UserID=${r.userId}, TextLength=${r.extractedText?.length || 0}`);
    }

    const scrapedJobsCount = await (prisma as any).scrapedJob.count();
    console.log(`Scraped jobs count: ${scrapedJobsCount}`);

    const applicationsCount = await prisma.jobApplication.count();
    console.log(`Applications count: ${applicationsCount}`);
    
    const apps = await prisma.jobApplication.findMany();
    for (const a of apps) {
      console.log(`App: ID=${a.id}, Company=${a.companyName}, Position=${a.positionTitle}, Status=${a.status}`);
    }
  } catch (error: any) {
    console.error('Error checking DB:', error.message);
  }
}

checkDb();
