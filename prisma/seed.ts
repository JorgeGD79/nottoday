import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL ?? "admin@nottoday.com";
  const password = process.env.SEED_ADMIN_PASSWORD;

  // Sin fallback: crear un admin con contraseña por defecto conocida es una
  // puerta trasera. Exigimos que se proporcione explícitamente al sembrar.
  if (!password || password.length < 12) {
    throw new Error(
      "SEED_ADMIN_PASSWORD es obligatoria (mínimo 12 caracteres). Defínela en el entorno antes de ejecutar el seed."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: { name: "NOTTODAY Admin", email, password: passwordHash, role: Role.ADMIN },
  });

  // eslint-disable-next-line no-console
  console.log(`Usuario ADMIN listo: ${admin.email} (cambia la contraseña tras el primer login)`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
