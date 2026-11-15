-- AlterTable
ALTER TABLE "coin_packages" ADD COLUMN     "label" VARCHAR(40);


-- Final prices (founder, 15 Nov 2026). First-time bonuses only; no standing bonus.
UPDATE coin_packages SET price_kobo =  100000, bonus_coins = 0, first_purchase_bonus =  100, label = NULL            WHERE coins =   500;
UPDATE coin_packages SET price_kobo =  350000, bonus_coins = 0, first_purchase_bonus =  400, label = 'Most popular' WHERE coins =  2000;
UPDATE coin_packages SET price_kobo = 1500000, bonus_coins = 0, first_purchase_bonus = 2000, label = NULL            WHERE coins = 10000;
UPDATE coin_packages SET price_kobo = 4000000, bonus_coins = 0, first_purchase_bonus = 7500, label = NULL            WHERE coins = 30000;
