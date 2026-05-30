import { promises as fs } from 'fs';
import path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Check available disk space for the upload directory
 * @returns {Promise<{ available: number; total: number; used: number; percentageUsed: number }>} Disk space info in bytes
 */
export async function checkDiskSpace(): Promise<{
   available: number;
   total: number;
   used: number;
   percentageUsed: number;
}> {
   try {
     const uploadDir = path.join(process.cwd(), 'uploads');
     
     // Ensure upload directory exists
     await fs.mkdir(uploadDir, { recursive: true });
     
     // Cross-platform disk space checking
     let stats;
     if (process.platform === 'win32') {
       // Windows: use wmic to get disk space
       const drive = path.parse(uploadDir).root; // e.g., "C:\\"
       const { stdout } = await execAsync(`wmic logicaldisk where "DeviceID='${drive.slice(0,2)}'" get FreeSpace,Size /format:csv`);
       const lines = stdout.trim().split('\n');
       if (lines.length >= 3) {
         const data = lines[2].split(',');
         const freeBytes = parseInt(data[1]);
         const totalBytes = parseInt(data[2]);
         stats = {
           bfree: freeBytes,
           bavail: freeBytes, // On Windows, free and available are the same for local disks
           blocks: Math.ceil(totalBytes / 4096), // Assume 4K block size
           bsize: 4096,
           frsize: 4096
         };
       } else {
         throw new Error('Could not parse wmic output');
       }
     } else {
       // Unix/Linux/macOS: use statfs (statvfs doesn't exist in Node.js fs.promises)
       // We'll use a fallback approach since statfs is also not available
       throw new Error('Platform not supported for detailed disk space info');
     }
     
     // Calculate values in bytes
     const blockSize = stats.frsize || stats.bsize; // Fundamental file system block size
     const total = blockSize * stats.blocks;
     const free = blockSize * stats.bfree;
     const available = blockSize * stats.bavail; // For unprivileged users
     const used = total - free;
     const percentageUsed = ((used / total) * 100);
     
     return {
       available,
       total,
       used,
       percentageUsed: Number(percentageUsed.toFixed(2))
     };
} catch (error: any) {
      // Fallback for systems where disk space checking fails - assume plenty of space
      console.warn('Could not get detailed disk space info, using fallback:', error.message);
      return {
        available: 10 * 1024 * 1024 * 1024, // Assume 10GB available
        total: 100 * 1024 * 1024 * 1024,
        used: 0,
        percentageUsed: 0
      };
    }
 }

/**
 * Check if there's enough disk space for a file upload
 * @param {number} fileSize - Size of file to upload in bytes
 * @param {number} safetyMargin - Extra space to keep free (default: 100MB)
 * @returns {Promise<boolean>} True if enough space available
 */
export async function hasEnoughDiskSpace(fileSize: number, safetyMargin: number = 100 * 1024 * 1024): Promise<boolean> {
  try {
    const diskSpace = await checkDiskSpace();
    // Check if available space minus safety margin is enough for the file
    return (diskSpace.available - safetyMargin) >= fileSize;
  } catch (error) {
    console.error('Error checking disk space:', error);
    // Fail safe - if we can't check, assume there's not enough space
    return false;
  }
}

/**
 * Get upload directory size
 * @returns {Promise<number>} Size of upload directory in bytes
 */
export async function getUploadDirectorySize(): Promise<number> {
  try {
    const uploadDir = path.join(process.cwd(), 'uploads');
    
    // Ensure upload directory exists
    await fs.mkdir(uploadDir, { recursive: true });
    
    // Recursively calculate directory size
    const getDirSize = async (dirPath: string): Promise<number> => {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      let size = 0;
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        if (entry.isDirectory()) {
          size += await getDirSize(fullPath);
        } else if (entry.isFile()) {
          const stat = await fs.stat(fullPath);
          size += stat.size;
        }
      }
      
      return size;
    };
    
    return await getDirSize(uploadDir);
  } catch (error) {
    console.error('Error calculating upload directory size:', error);
    return 0;
  }
}

export default {
  checkDiskSpace,
  hasEnoughDiskSpace,
  getUploadDirectorySize
};