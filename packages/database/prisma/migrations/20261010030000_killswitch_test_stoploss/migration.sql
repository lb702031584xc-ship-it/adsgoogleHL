-- 测试止损（第七批）：kill_switch_configs 加花费上限 / X花费零转化两个阈值
ALTER TABLE "kill_switch_configs"
  ADD COLUMN "test_spend_cap" DECIMAL(12,2),
  ADD COLUMN "test_zero_conv_spend" DECIMAL(12,2);
