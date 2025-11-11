import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { AppConfig } from '../../config';
import type { UpdateVenueInput, VenueService } from '../../customer/venue-service';
import {
  createAuthorizationError,
  createNotFoundError,
  createValidationError,
  HttpError,
  replyWithProblem,
} from '../../http/problem';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional(),
  search: z.string().min(1).optional(),
  city: z.string().min(1).optional(),
  state: z.string().min(1).optional(),
  acceptingRequests: z.coerce.boolean().optional(),
});

const slugRegex = /^[a-z0-9-]+$/;

const baseVenueSchema = z.object({
  openkjVenueId: z.coerce.number().int().nonnegative(),
  urlName: z
    .string()
    .min(3)
    .max(120)
    .regex(slugRegex, 'URL name must contain only lowercase letters, numbers, and hyphens.'),
  acceptingRequests: z.boolean().optional(),
  name: z.string().min(1).max(200),
  address: z.string().min(1).max(240),
  city: z.string().min(1).max(120),
  state: z.string().min(1).max(120),
  postalCode: z.string().min(1).max(20),
  country: z
    .string()
    .length(2, 'Country must be a 2-letter ISO code.')
    .transform((value) => value.toUpperCase())
    .nullish(),
  phoneNumber: z.string().max(32).nullish(),
  website: z.string().url().max(240).nullish(),
});

const coordinatesSchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
});

const createVenueSchema = baseVenueSchema.merge(coordinatesSchema);

const updateVenueSchema = baseVenueSchema
  .partial()
  .merge(coordinatesSchema.partial())
  .superRefine((value, ctx) => {
    if ((value.latitude !== undefined) !== (value.longitude !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Latitude and longitude must both be provided together.',
        path: ['latitude'],
      });
    }
  });

const venueParamsSchema = z.object({
  venueId: z.string().uuid(),
});

type RegisterCustomerVenueRoutesOptions = {
  config: AppConfig;
  venueService: VenueService;
};

export async function registerCustomerVenueRoutes(
  app: FastifyInstance,
  options: RegisterCustomerVenueRoutesOptions,
) {
  const { venueService } = options;

  app.get('/v1/customer/venues', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.venues', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const query = parseQuery(listQuerySchema, request.query);
      const result = await venueService.listVenues(customerId, {
        ...query,
        search: query.search?.trim(),
        city: query.city?.trim(),
        state: query.state?.trim(),
      });
      reply.send(result);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.post('/v1/customer/venues', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.venues', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const body = parseBody(createVenueSchema, request.body);
      const venue = await venueService.createVenue(customerId, {
        openkjVenueId: body.openkjVenueId,
        urlName: body.urlName.toLowerCase(),
        acceptingRequests: body.acceptingRequests,
        name: body.name.trim(),
        address: body.address.trim(),
        city: body.city.trim(),
        state: body.state.trim(),
        postalCode: body.postalCode.trim(),
        country: body.country ?? null,
        phoneNumber: body.phoneNumber === undefined ? null : (body.phoneNumber?.trim() ?? null),
        website: body.website === undefined ? null : (body.website?.trim() ?? null),
        latitude: body.latitude,
        longitude: body.longitude,
      });

      reply.code(201).send(venue);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.get('/v1/customer/venues/:venueId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.venues', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(venueParamsSchema, request.params);
      const venue = await venueService.getVenue(customerId, params.venueId);
      if (!venue) {
        throw createNotFoundError('Venue', { venueId: params.venueId });
      }

      reply.send(venue);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.patch('/v1/customer/venues/:venueId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.venues', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(venueParamsSchema, request.params);
      const body = parseBody(updateVenueSchema, request.body);

      if (Object.keys(body).length === 0) {
        throw createValidationError('At least one field must be provided to update a venue.');
      }

      const updatePayload: UpdateVenueInput = {};

      if (body.openkjVenueId !== undefined) {
        updatePayload.openkjVenueId = body.openkjVenueId;
      }

      if (body.urlName !== undefined) {
        updatePayload.urlName = body.urlName.toLowerCase();
      }

      if (body.acceptingRequests !== undefined) {
        updatePayload.acceptingRequests = body.acceptingRequests;
      }

      if (body.name !== undefined) {
        updatePayload.name = body.name.trim();
      }

      if (body.address !== undefined) {
        updatePayload.address = body.address.trim();
      }

      if (body.city !== undefined) {
        updatePayload.city = body.city.trim();
      }

      if (body.state !== undefined) {
        updatePayload.state = body.state.trim();
      }

      if (body.postalCode !== undefined) {
        updatePayload.postalCode = body.postalCode.trim();
      }

      if (body.country !== undefined) {
        updatePayload.country = body.country ?? null;
      }

      if (body.phoneNumber !== undefined) {
        updatePayload.phoneNumber = body.phoneNumber === null ? null : body.phoneNumber.trim();
      }

      if (body.website !== undefined) {
        updatePayload.website = body.website === null ? null : body.website.trim();
      }

      if (body.latitude !== undefined && body.longitude !== undefined) {
        updatePayload.latitude = body.latitude;
        updatePayload.longitude = body.longitude;
      }

      const venue = await venueService.updateVenue(customerId, params.venueId, updatePayload);

      reply.send(venue);
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });

  app.delete('/v1/customer/venues/:venueId', async (request, reply) => {
    try {
      const customerId = requireCustomerContext(request);
      request.authorization.requireOrganizationPermission('customer.venues', {
        organizationId: customerId,
        useActiveContext: true,
        allowGlobalAdmin: true,
      });

      const params = parseParams(venueParamsSchema, request.params);
      await venueService.deleteVenue(customerId, params.venueId);
      reply.code(204).send();
    } catch (error) {
      await handleRouteError(reply, error);
    }
  });
}

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    return parsed.data;
  }

  throw createValidationError('Invalid request body.', {
    fieldErrors: parsed.error.flatten().fieldErrors,
    formErrors: parsed.error.flatten().formErrors,
  });
}

function parseQuery<T>(schema: z.ZodType<T>, query: unknown): T {
  const parsed = schema.safeParse(query);
  if (parsed.success) {
    return parsed.data;
  }

  throw createValidationError('Invalid query parameters.', {
    fieldErrors: parsed.error.flatten().fieldErrors,
    formErrors: parsed.error.flatten().formErrors,
  });
}

function parseParams<T>(schema: z.ZodType<T>, params: unknown): T {
  const parsed = schema.safeParse(params);
  if (parsed.success) {
    return parsed.data;
  }

  throw createValidationError('Invalid route parameters.', {
    fieldErrors: parsed.error.flatten().fieldErrors,
    formErrors: parsed.error.flatten().formErrors,
  });
}

async function handleRouteError(reply: FastifyReply, error: unknown) {
  if (error instanceof HttpError) {
    replyWithProblem(reply, error.problem);
    return;
  }

  throw error;
}

function requireCustomerContext(request: FastifyRequest): string {
  const user = request.authorization.requireUser();
  const context = request.authorization.activeContext;

  if (context?.type === 'customer') {
    return context.id;
  }

  throw createAuthorizationError('Active customer context is required.', {
    reason: 'customer_context_required',
    userId: user.id,
  });
}
