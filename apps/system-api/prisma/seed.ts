import { PrismaClient, BrandingOwnerType, BrandingStatus } from '@prisma/client';

const prisma = new PrismaClient();

async function seedPermissions() {
  const permissions = [
    { slug: 'system.admin', description: 'Full access to platform administration features.' },
    { slug: 'system.support', description: 'Access to support tooling and read-only system data.' },
    {
      slug: 'customer.manage',
      description: 'Manage customer settings, billing, and configuration.',
    },
    {
      slug: 'customer.billing',
      description: 'Access billing and subscription management features.',
    },
    { slug: 'customer.venues', description: 'Create and manage venue records.' },
    { slug: 'customer.systems', description: 'Manage karaoke systems and OpenKJ integrations.' },
    { slug: 'customer.api-keys', description: 'Issue and revoke customer API keys.' },
    { slug: 'customer.branding', description: 'Configure branding profiles and assets.' },
    { slug: 'customer.users', description: 'Invite and manage organization users.' },
    { slug: 'customer.songdb', description: 'Import and manage song catalog data.' },
    { slug: 'singer.profile', description: 'Manage singer profile details.' },
    { slug: 'singer.requests', description: 'Submit and manage singer song requests.' },
    { slug: 'singer.favorites', description: 'Manage singer favorites lists.' },
  ];

  for (const permission of permissions) {
    await prisma.permission.upsert({
      where: { slug: permission.slug },
      update: { description: permission.description },
      create: permission,
    });
  }

  return permissions.map((permission) => permission.slug);
}

async function seedRoles() {
  const roles = [
    {
      slug: 'platform-admin',
      description: 'Singr platform administrator',
      isSystem: true,
      permissions: [
        'system.admin',
        'system.support',
        'customer.manage',
        'customer.billing',
        'customer.venues',
        'customer.systems',
        'customer.api-keys',
        'customer.branding',
        'customer.users',
        'customer.songdb',
        'singer.profile',
        'singer.requests',
        'singer.favorites',
      ],
    },
    {
      slug: 'platform-support',
      description: 'Support engineers with scoped read access',
      isSystem: true,
      permissions: [
        'system.support',
        'customer.manage',
        'customer.venues',
        'customer.systems',
        'customer.api-keys',
        'customer.branding',
        'customer.users',
        'customer.songdb',
      ],
    },
    {
      slug: 'customer-admin',
      description: 'Customer organization administrator',
      isSystem: false,
      permissions: [
        'customer.manage',
        'customer.billing',
        'customer.venues',
        'customer.systems',
        'customer.api-keys',
        'customer.branding',
        'customer.users',
        'customer.songdb',
      ],
    },
    {
      slug: 'customer-manager',
      description: 'Customer manager with operational permissions',
      isSystem: false,
      permissions: [
        'customer.venues',
        'customer.systems',
        'customer.api-keys',
        'customer.branding',
        'customer.users',
        'customer.songdb',
      ],
    },
    {
      slug: 'singer',
      description: 'Singer profile default role',
      isSystem: false,
      permissions: ['singer.profile', 'singer.requests', 'singer.favorites'],
    },
  ];

  for (const role of roles) {
    const createdRole = await prisma.role.upsert({
      where: { slug: role.slug },
      update: { description: role.description, isSystem: role.isSystem },
      create: {
        slug: role.slug,
        description: role.description,
        isSystem: role.isSystem,
      },
    });

    const permissionRecords = await prisma.permission.findMany({
      where: { slug: { in: role.permissions } },
      select: { id: true, slug: true },
    });

    for (const permission of permissionRecords) {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: createdRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: createdRole.id,
          permissionId: permission.id,
        },
      });
    }
  }
}

async function seedBrandingProfile() {
  await prisma.brandingProfile.upsert({
    where: {
      ownerType_ownerId_name: {
        ownerType: BrandingOwnerType.platform,
        ownerId: null,
        name: 'Singr Platform',
      },
    },
    update: {
      status: BrandingStatus.active,
      poweredBySingr: true,
    },
    create: {
      ownerType: BrandingOwnerType.platform,
      ownerId: null,
      name: 'Singr Platform',
      logoUrl: null,
      colorPalette: { primary: '#6C2BD9', secondary: '#FF6B6B' },
      metadata: {},
    },
  });
}

async function seedAdminUser() {
  const adminEmail = 'admin@singrkaraoke.com';
  const adminUser = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {
      isEmailVerified: false,
      displayName: 'Singr Admin (Pending Activation)',
    },
    create: {
      email: adminEmail,
      name: 'Platform Admin',
      displayName: 'Singr Admin (Pending Activation)',
      isEmailVerified: false,
      passwordHash: null,
      passwordAlgo: null,
    },
  });

  const platformAdminRole = await prisma.role.findUniqueOrThrow({
    where: { slug: 'platform-admin' },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: {
        userId: adminUser.id,
        roleId: platformAdminRole.id,
      },
    },
    update: {},
    create: {
      userId: adminUser.id,
      roleId: platformAdminRole.id,
    },
  });
}

async function main() {
  await seedPermissions();
  await seedRoles();
  await seedBrandingProfile();
  await seedAdminUser();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    // eslint-disable-next-line no-console
    console.error('Failed to seed database', error);
    await prisma.$disconnect();
    process.exit(1);
  });
