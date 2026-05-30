import { runScheduledTasks, shouldRunAutomation, isSchedulerRunning } from '../../services/scheduler.service';

const mockPrismaUserFindMany = jest.fn();
const mockPrismaUserUpdate = jest.fn();

jest.mock('../../prisma/index', () => ({
  __esModule: true,
  default: {
    user: {
      findMany: (...args: unknown[]) => mockPrismaUserFindMany(...args),
      update: (...args: unknown[]) => mockPrismaUserUpdate(...args),
    },
  },
}));

jest.mock('../../services/auto-apply.service', () => ({
  runAutoApply: jest.fn().mockResolvedValue({
    results: [],
    extractedKeywords: [],
    sourceStats: {},
  }),
}));

describe('Scheduler Overlap Guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isSchedulerRunning flag', () => {
    it('should not allow concurrent execution when isSchedulerRunning is true', async () => {
      const originalRunning = isSchedulerRunning;

      Object.assign(require('../../services/scheduler.service'), { isSchedulerRunning: true });

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        preferences: {
          automation: {
            enabled: true,
            frequency: 'hourly',
            keywords: 'developer',
          },
        },
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);

      const runPromise = runScheduledTasks();
      await new Promise(resolve => setImmediate(resolve));

      expect(consoleWarnSpy).toHaveBeenCalledWith(
        'Scheduler tick skipped: previous run still in progress'
      );

      consoleWarnSpy.mockRestore();
      Object.assign(require('../../services/scheduler.service'), { isSchedulerRunning: originalRunning });
    });
  });

  describe('shouldRunAutomation', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should return true when nextRun is in the past', () => {
      const pastTime = new Date(Date.now() - 3600000);
      const automation = {
        nextRun: pastTime,
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, new Date());
      expect(result).toBe(true);
    });

    it('should return false when nextRun is in the future', () => {
      const futureTime = new Date(Date.now() + 3600000);
      const automation = {
        nextRun: futureTime,
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, new Date());
      expect(result).toBe(false);
    });

    it('should respect frequency when lastRun is recent for hourly', () => {
      const now = new Date();
      const recentLastRun = new Date(now.getTime() - 30 * 60 * 1000);
      const automation = {
        lastRun: recentLastRun,
        frequency: 'hourly',
      };

      const result = shouldRunAutomation(automation, now);
      expect(result).toBe(false);
    });

    it('should allow run when hourly frequency has elapsed', () => {
      const now = new Date();
      const oldLastRun = new Date(now.getTime() - 2 * 60 * 60 * 1000);
      const automation = {
        lastRun: oldLastRun,
        frequency: 'hourly',
      };

      const result = shouldRunAutomation(automation, now);
      expect(result).toBe(true);
    });

    it('should respect daily frequency', () => {
      const now = new Date();
      const yesterday = new Date(now.getTime() - 25 * 60 * 60 * 1000);
      const automation = {
        lastRun: yesterday,
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, now);
      expect(result).toBe(true);
    });

    it('should return false when lastRun is recent for daily frequency', () => {
      const now = new Date();
      const recentLastRun = new Date(now.getTime() - 12 * 60 * 60 * 1000);
      const automation = {
        lastRun: recentLastRun,
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, now);
      expect(result).toBe(false);
    });

    it('should return true when no lastRun or nextRun is set', () => {
      const automation = {
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, new Date());
      expect(result).toBe(true);
    });

    it('should handle invalid dates gracefully', () => {
      const automation = {
        nextRun: 'invalid-date',
        frequency: 'daily',
      };

      const result = shouldRunAutomation(automation, new Date());
      expect(result).toBe(true);
    });
  });

  describe('runScheduledTasks', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should skip users with automation disabled', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        preferences: {
          automation: {
            enabled: false,
            frequency: 'daily',
          },
        },
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);
      mockPrismaUserUpdate.mockResolvedValue(mockUser);

      await runScheduledTasks();

      expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
    });

    it('should skip users with no automation preferences', async () => {
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        preferences: {},
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);
      mockPrismaUserUpdate.mockResolvedValue(mockUser);

      await runScheduledTasks();

      expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
    });

    it('should skip users when shouldRunAutomation returns false', async () => {
      const now = new Date();
      const futureTime = new Date(now.getTime() + 3600000);
      
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        preferences: {
          automation: {
            enabled: true,
            frequency: 'daily',
            nextRun: futureTime,
          },
        },
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);
      mockPrismaUserUpdate.mockResolvedValue(mockUser);

      await runScheduledTasks();

      expect(mockPrismaUserUpdate).not.toHaveBeenCalled();
    });

    it('should update user preferences after successful automation run', async () => {
      const now = new Date();
      const mockUser = {
        id: 'user-1',
        email: 'test@example.com',
        preferences: {
          automation: {
            enabled: true,
            frequency: 'hourly',
            keywords: 'developer',
            lastRun: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          },
        },
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);
      mockPrismaUserUpdate.mockResolvedValue(mockUser);

      await runScheduledTasks();

      expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
        })
      );

      const updateCall = mockPrismaUserUpdate.mock.calls[0][0];
      expect(updateCall.data.preferences.automation.status).toBe('completed');
      expect(updateCall.data.preferences.automation.lastRun).toBeDefined();
    });

    it('should handle multiple users with different automation states', async () => {
      const now = new Date();
      
      const users = [
        {
          id: 'user-1',
          email: 'user1@example.com',
          preferences: {
            automation: {
              enabled: true,
              frequency: 'hourly',
              lastRun: new Date(now.getTime() - 2 * 60 * 60 * 1000),
            },
          },
        },
        {
          id: 'user-2',
          email: 'user2@example.com',
          preferences: {
            automation: {
              enabled: false,
              frequency: 'daily',
            },
          },
        },
        {
          id: 'user-3',
          email: 'user3@example.com',
          preferences: {
            automation: {
              enabled: true,
              frequency: 'daily',
              nextRun: new Date(now.getTime() + 3600000),
            },
          },
        },
      ];

      mockPrismaUserFindMany.mockResolvedValue(users);
      mockPrismaUserUpdate.mockResolvedValue({});

      await runScheduledTasks();

      expect(mockPrismaUserUpdate).toHaveBeenCalledTimes(1);
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
        })
      );
    });

    it('should handle errors gracefully for individual users', async () => {
      const now = new Date();
      const mockUser = {
        id: 'user-error',
        email: 'error@example.com',
        preferences: {
          automation: {
            enabled: true,
            frequency: 'hourly',
            lastRun: new Date(now.getTime() - 2 * 60 * 60 * 1000),
          },
        },
      };

      mockPrismaUserFindMany.mockResolvedValue([mockUser]);

      const { runAutoApply } = require('../../services/auto-apply.service');
      (runAutoApply as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      mockPrismaUserUpdate.mockResolvedValue(mockUser);

      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      await runScheduledTasks();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(mockPrismaUserUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            preferences: expect.objectContaining({
              automation: expect.objectContaining({
                status: 'error',
              }),
            }),
          }),
        })
      );

      consoleErrorSpy.mockRestore();
    });
  });
});
