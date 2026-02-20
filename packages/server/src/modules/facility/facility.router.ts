import { Router, Request, Response, NextFunction } from 'express';
import { createFacilitySchema, updatePolicySchema } from '@badminton/shared';
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
    const facility = await facilityService.getFacility(req.params.id);
    res.json(facility);
  } catch (err) { next(err); }
});

router.get('/:id/qr', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const qr = await facilityService.getQrCode(req.params.id);
    res.json({ qrCode: qr });
  } catch (err) { next(err); }
});

router.get('/:id/policy', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await facilityService.getPolicy(req.params.id);
    res.json(policy);
  } catch (err) { next(err); }
});

router.put('/:id/policy', authenticate, validate(updatePolicySchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const policy = await facilityService.updatePolicy(req.params.id, req.user!.userId, req.body);
    res.json(policy);
  } catch (err) { next(err); }
});

router.get('/:id/board', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const board = await facilityService.getBoard(req.params.id);
    res.json(board);
  } catch (err) { next(err); }
});

// GET /facilities/:id/display - TV display mode data
router.get('/:id/display', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const display = await facilityService.getDisplayBoard(req.params.id);
    res.json(display);
  } catch (err) { next(err); }
});

// Court endpoints nested under facility
router.post('/:id/courts', authenticate, roleGuard('FACILITY_ADMIN'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { createCourtSchema } = await import('@badminton/shared');
    const body = createCourtSchema.parse(req.body);
    const { createCourt } = await import('../court/court.service');
    const court = await createCourt(req.params.id, body);
    res.status(201).json(court);
  } catch (err) { next(err); }
});

router.get('/:id/courts', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { listCourts } = await import('../court/court.service');
    const courts = await listCourts(req.params.id);
    res.json(courts);
  } catch (err) { next(err); }
});

export default router;
