import axios from 'axios';

async function testApis() {
  const sources = [
    { name: 'Remotive', url: 'https://remotive.com/api/remote-jobs?search=react&limit=5' },
    { name: 'WWR api/jobs', url: 'https://weworkremotely.com/api/jobs?search=react' },
    { name: 'WWR api/v1/jobs', url: 'https://weworkremotely.com/api/v1/jobs?search=react' },
    { name: 'WWR api/v1/jobs.json', url: 'https://weworkremotely.com/api/v1/jobs.json?search=react' },
    { name: 'WWR api/v1/remote-jobs', url: 'https://weworkremotely.com/api/v1/remote-jobs?search=react' },
    { name: 'Remote OK', url: 'https://remoteok.com/api?search=react' },
    { name: 'Arbeitnow', url: 'https://www.arbeitnow.com/api/job-board-api?search=react&per_page=5' }
  ];

  for (const source of sources) {
    try {
      console.log(`Testing ${source.name}...`);
      const response = await axios.get(source.url, {
        timeout: 10000,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
      });
      console.log(`${source.name} success! Status: ${response.status}`);
      if (source.name === 'Remote OK') {
        console.log(`Length of data: ${Array.isArray(response.data) ? response.data.length : typeof response.data}`);
      } else if (source.name === 'Remotive') {
        console.log(`Jobs count: ${response.data?.jobs?.length || 0}`);
      } else if (source.name === 'We Work Remotely') {
        console.log(`Jobs count: ${response.data?.jobs?.length || 0}`);
      } else if (source.name === 'Arbeitnow') {
        console.log(`Jobs count: ${response.data?.data?.length || 0}`);
      }
    } catch (err: any) {
      console.error(`${source.name} failed: ${err.message}`);
    }
  }
}

testApis();
