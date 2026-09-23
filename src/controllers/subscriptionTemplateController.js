const SubscriptionTemplate = require("../models/SubscriptionTemplate");
const boxModel = require("../models/Box");
const { paginate } = require("../utils/pagination");

class SubscriptionTemplateController {
  async createTemplate(req, res, next) {
    try {
      const validated = req.validatedBody;

      const box = await boxModel.findById(validated.boxId);
      if (!box) {
        return res
          .status(404)
          .json({ success: false, message: "Box not found" });
      }

      if (validated.gift && validated.gift.length > 0) {
        for (const gift of validated.gift) {
          const giftBox = await boxModel.findById(gift.boxId);
          if (!giftBox)
            return res.status(404).json({
              success: false,
              message: `Gift box with ID ${gift.boxId} not found`,
            });
        }
      }

      const template = new SubscriptionTemplate({
        name: validated.name,
        description: validated.description || "",
        boxId: validated.boxId,
        planType: validated.planType,
        basePrice: box.value,
        discountPercent: validated.discountPercent || 0,
        gift: validated.gift || [],
      });

      template.discountPrice =
        template.basePrice * (1 - template.discountPercent / 100);
      await template.save();

      await template.populate("boxId", "name value");
      await template.populate("gift.boxId", "name");

      res.status(201).json({
        success: true,
        message: "Subscription template created successfully",
        data: template,
      });
    } catch (error) {
      next(error);
    }
  }

  async getAllTemplates(req, res, next) {
    try {
      // [FIX]: Áp dụng phân trang thay vì find()
      const { data, pagination } = await paginate(
        SubscriptionTemplate,
        req.query,
        {},
        {
          populate: [
            { path: "boxId", select: "name value" },
            { path: "gift.boxId", select: "name" },
          ],
          sort: { createdAt: -1 },
        },
      );

      res.status(200).json({
        success: true,
        count: data.length,
        data: data,
        pagination: pagination,
      });
    } catch (error) {
      next(error);
    }
  }

  async getTemplateById(req, res, next) {
    try {
      const template = await SubscriptionTemplate.findById(req.params.id)
        .populate("boxId", "name value")
        .populate("gift.boxId", "name");

      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "Subscription template not found" });
      res.status(200).json({ success: true, data: template });
    } catch (error) {
      next(error);
    }
  }

  async updateTemplate(req, res, next) {
    try {
      const validated = req.validatedBody;
      let template = await SubscriptionTemplate.findById(req.params.id);

      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "Subscription template not found" });

      if (validated.boxId && validated.boxId !== template.boxId.toString()) {
        const box = await boxModel.findById(validated.boxId);
        if (!box)
          return res
            .status(404)
            .json({ success: false, message: "Box not found" });
        template.boxId = validated.boxId;
        template.basePrice = box.value;
      }

      if (validated.gift && validated.gift.length > 0) {
        for (const gift of validated.gift) {
          const giftBox = await boxModel.findById(gift.boxId);
          if (!giftBox)
            return res.status(404).json({
              success: false,
              message: `Gift box with ID ${gift.boxId} not found`,
            });
        }
        template.gift = validated.gift;
      }

      if (validated.name) template.name = validated.name;
      if (validated.description !== undefined)
        template.description = validated.description;
      if (validated.planType) template.planType = validated.planType;
      if (validated.discountPercent !== undefined)
        template.discountPercent = validated.discountPercent;
      if (validated.isActive !== undefined)
        template.isActive = validated.isActive;

      template.discountPrice =
        template.basePrice * (1 - template.discountPercent / 100);
      await template.save();
      await template.populate("boxId", "name value");
      await template.populate("gift.boxId", "name");

      res.status(200).json({
        success: true,
        message: "Subscription template updated successfully",
        data: template,
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteTemplate(req, res, next) {
    try {
      const template = await SubscriptionTemplate.findByIdAndDelete(
        req.params.id,
      );
      if (!template)
        return res
          .status(404)
          .json({ success: false, message: "Subscription template not found" });
      res.status(200).json({
        success: true,
        message: "Subscription template deleted successfully",
      });
    } catch (error) {
      next(error);
    }
  }

  async getActiveTemplates(req, res, next) {
    try {
      const templates = await SubscriptionTemplate.find({ isActive: true })
        .populate("boxId", "name value image")
        .populate("gift.boxId", "name image")
        .sort({ createdAt: -1 })
        .limit(50);

      res
        .status(200)
        .json({ success: true, count: templates.length, data: templates });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SubscriptionTemplateController();
