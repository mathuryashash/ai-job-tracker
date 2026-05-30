import { AutomationService } from '../services/AutomationService';

async function testRun() {
  const userId = 'cmpnn3c0h0000pdt72oybffga'; // yashash.mathur@test.com
  const service = new AutomationService();
  try {
    console.log('Starting dry-run automation for user...');
    const result = await service.run({
      userId,
      keywords: 'React Node',
      location: 'Remote',
      matchThreshold: 50, // Let's set it low so we get matches
      autoTailorResume: false, // Save time
      autoGenerateCoverLetter: false, // Save time
      useAIKeywords: false, // Don't call OpenRouter for query extraction, use manual keywords
      remote: true,
    });
    console.log('Automation run completed successfully!');
    console.log(`Results length: ${result.results.length}`);
    console.log('Results summary:', JSON.stringify(result.results.map(r => ({
      title: r.job.title,
      company: r.job.company,
      location: r.job.location,
      match: r.matchResult.matchPercentage,
      created: r.applicationCreated,
      error: r.error
    })), null, 2));
    console.log('Source stats:', result.sourceStats);
  } catch (error: any) {
    console.error('Automation run failed with error:', error);
  }
}

testRun();
