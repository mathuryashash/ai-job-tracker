import prisma from '../prisma/index';

async function printResume() {
  const resume = await prisma.resume.findFirst({
    where: { userId: 'cmpnn3c0h0000pdt72oybffga' },
    orderBy: { createdAt: 'desc' },
  });
  if (resume) {
    console.log(`Resume ID: ${resume.id}`);
    console.log(`Filename: ${resume.filename}`);
    console.log(`Extracted Text:\n${resume.extractedText}`);
  } else {
    console.log('No resume found');
  }
}

printResume();
