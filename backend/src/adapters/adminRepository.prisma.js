const createPrismaAdminRepository = (prisma) => ({
  findByIdForIssueToken: async (adminId) => {
    return prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        role: true,
        adminPlanStatus: true,
        adminPlan: {
          select: {
            code: true,
          },
        },
      },
    });
  },

  findByIdForPublicApiAuth: async (adminId) => {
    return prisma.user.findUnique({
      where: { id: adminId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        adminPlanStatus: true,
        adminPlan: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });
  },
});

module.exports = {
  createPrismaAdminRepository,
};
