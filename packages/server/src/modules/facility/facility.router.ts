import { Router, Request, Response, NextFunction } from 'express';
import { createFacilitySchema, updatePolicySchema, updateCoordinatesSchema } from '@badminton/shared';
import { authenticate } from '../../middleware/auth';
import { roleGuard } from '../../middleware/roleGuard';
import { validate } from '../../middleware/validate';
import * as facilityService from './facility.service';

const router = Router();

router.post('/', authenticate, roleGuard('FACILITY_ADMIN'), validate(createFacilitySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facility = await facilityService.createFacility(req.user!.userId, req.body);
    res.status(201).json(facility);
  } catch (err) { next(err); }
});

router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const facilities = await facilityService.listFacilities();
    res.json(facilities);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facility = await facilityService.getFacility(req.params.id as string);
    res.json(facility);
  } catch (err) { next(err); }
});

router.get('/:id/qr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const qr = await facilityService.getQrCode(req.params.id as string);
    res.json({ qrCode: qr });
  } catch (err) { next(err); }
});

router.get('/:id/policy', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await facilityService.getPolicy(req.params.id as string);
    res.json(policy);
  } catch (err) { next(err); }
});

router.put('/:id/policy', authenticate, validate(updatePolicySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await facilityService.updatePolicy(req.params.id as string, req.user!.userId, req.body);
    res.json(policy);
  } catch (err) { next(err); }
});

router.put('/:id/coordinates', authenticate, roleGuard('FACILITY_ADMIN'), validate(updateCoordinatesSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const facility = await facilityService.updateCoordinates(req.params.id as string, req.user!.userId, req.body);
    res.json(facility);
  } catch (err) { next(err); }
});

router.get('/:id/board', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const board = await facilityService.getBoard(req.params.id as string);
    res.json(board);
  } catch (err) { next(err); }
});

// GET /facilities/:id/display - TV display mode data
router.get('/:id/display', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const display = await facilityService.getDisplayBoard(req.params.id as string);
    res.json(display);
  } catch (err) { next(err); }
});

// GET /facilities/:id/stats/today - today's stats
router.get('/:id/stats/today', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await facilityService.getTodayStats(req.params.id as string);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /facilities/:id/stats/weekly - weekly game trends
router.get('/:id/stats/weekly', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await facilityService.getWeeklyTrends(req.params.id as string);
    res.json(stats);
  } catch (err) { next(err); }
});

// GET /facilities/:id/stats/peak-hours - peak hours heatmap
router.get('/:id/stats/peak-hours', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const stats = await facilityService.getPeakHours(req.params.id as string);
    res.json(stats);
  } catch (err) { next(err); }
});

// NOTE: Facility-LEVEL court CRUD (POST/GET /:id/courts, clubSessionId=null)
// was retired with the old facility-admin dashboard. Per-정모 court logic lives
// under the club session, not here.

// GET /facilities/:id/players - get available players with status
router.get('/:id/players', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getAvailablePlayers } = await import('../checkin/checkin.service');
    const players = await getAvailablePlayers(req.params.id as string);
    res.json(players);
  } catch (err) { next(err); }
});

// GET /facilities/:id/capacity - facility capacity status
router.get('/:id/capacity', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { getFacilityCapacity } = await import('../checkin/checkin.service');
    const capacity = await getFacilityCapacity(req.params.id as string);
    res.json(capacity);
  } catch (err) { next(err); }
});

export default router;
